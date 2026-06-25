# 流程 C 代码审查报告（W3 阶段）

**审查范围**：W3-C 全部新增/改动文件（基于 commit `24ea228` → `99e2704`，5 个 commit）
**审查时间**：2026-06-26（Asia/Dili）
**审查员**：代码审查员（GLM-5.2，Claude Code harness）
**审查基准**：`w3-flow-c` HEAD = `99e2704`

---

## 📋 代码审查报告

### 总体印象

整体架构清晰、注释充分、决策依据可追溯。乐观锁抢单、IdempotencyKey 生命周期、BullMQ delayed job、Redis 缓存容错这四个核心机制设计到位。**但存在 1 个严重业务回归 bug（下单后购物车未清空）和 1 个鉴权缺口（rider/apply 无 @Roles）必须修复**。测试覆盖聚焦核心路径（31 个新单测），但 dispatch/rider service 层 0 单测、无 e2e，是后续阶段的债务。

---

### 🏗️ 架构与结构

**分层清晰**：
- `shared/idempotency/` — `@Global` Module，跨模块复用 ✓
- `shared/queue/` — BullModule.forRoot 共享，feature 模块各自 registerQueue ✓
- `modules/dispatch/` — Service + Controller + Module，DI token 隔离 ✓
- `modules/rider/` — 3 个 Controller 按路由前缀拆分（common/rider/admin），符合权限边界 ✓
- `modules/order/` — Service + Processor + Helper 三件套，职责分明 ✓

**亮点**：
- 用 `DISPATCH_SERVICE_TOKEN` + `DispatchServiceLike` 接口避免 Order ↔ Dispatch 循环依赖（`order.service.ts:57-60`）
- `OrderTimeoutProcessor` 与 `OrderService` 拆开后，Processor 消费侧逻辑不污染 Service（`order-timeout.processor.ts`）
- migration 用 TEXT 而非 enum，规避与 W/M 流程的 enum migration 撞（`migration.sql:4`）

**关注点**：
- `apps/api/src/modules/order/order.module.ts:31` 显式 `{ provide: 'DISPATCH_SERVICE_TOKEN', useExisting: DISPATCH_SERVICE_TOKEN }` 是为了规避 tsx esbuild 不生成 emitDecoratorMetadata 的 workaround —— 后续切换到 tsc/swc 编译后可以简化

---

### 🔴 阻塞项（必须修复）

#### B1. 下单后购物车未清空 — 业务回归 bug

**文件**：`apps/api/src/modules/order/order.service.ts` 与 `apps/api/src/modules/cart/cart.service.ts:367`

**问题**：
`cart.service.ts` 定义了 `clearOrderedItems(userId, skuIds)` 方法，注释明确写：
> "由 OrderService 在 createOrder 成功后调用（已选 items 删除）"

但 grep 全代码库，`clearOrderedItems` 只在定义处出现，**没有任何调用方**。`OrderService.createOrder` Step 7（创建 PaymentIntent）之后直接 return，**完全没有清空购物车**。

**用户影响**：
- 用户下单成功 → 购物车商品依然存在 → 进入订单列表再回来，购物车还是满的
- 用户改主意想再下一单 → 默认勾选了已下单的商品 → 用户没注意 → **重复扣库存 + 重复支付**
- 即使用户手动取消选中，体验也是灾难

**修复建议**：

```typescript
// order.service.ts constructor 加注入
constructor(
  private readonly orderNoService: OrderNoService,
  @Inject('PaymentServiceToken') private readonly paymentService: PaymentService,
  @Inject(ORDER_TIMEOUT_QUEUE) private readonly timeoutQueue: Queue<OrderTimeoutJobData>,
  @Inject('DISPATCH_SERVICE_TOKEN') private readonly dispatchService: DispatchServiceLike | null,
  @Inject('CartServiceToken') private readonly cartService: CartServiceLike, // 新增
) {}

// createOrder Step 7 之后（return 之前）加：
const skuIds = input.items.map((i) => i.skuId);
try {
  await this.cartService.clearOrderedItems(input.userId, skuIds);
} catch (e) {
  // 容错：清购物车失败不阻塞下单（用户可手动清，但订单已成功）
  logger.warn({
    msg: 'CART_CLEAR_AFTER_ORDER_FAILED',
    orderId: created.id,
    userId: input.userId,
    error: (e as Error).message,
  });
}
```

注意：注入 `CartService` 也可能造成 Order ↔ Cart 循环依赖，需要用 token + 接口隔离（参考 `DISPATCH_SERVICE_TOKEN` 模式）。

---

#### B2. `RiderApplicationController` 缺 `@Roles` 装饰器 — 鉴权缺口

**文件**：`apps/api/src/modules/rider/rider.controller.ts:69-94`

**问题**：
```typescript
@Controller('api/v1/common/rider')
// ❌ 缺 @Roles('customer')
export class RiderApplicationController {
  @Post('apply')
  @Audit({ resource: 'RiderProfile' })
  async apply(...) { ... }
}
```

注释里写"common 前缀，client_app 登录后申请"，但代码没强制 `role=customer`。如果全局 Guard 的兜底逻辑是"未标 @Roles 即放行"，那么：

- 持有效 JWT 的 `rider` / `warehouse_staff` / `customer_service` / `super_admin` 都能调 apply
- 一个 `super_admin` 误调 apply 会创建 RiderProfile，污染 user_id 唯一约束（后续该用户无法用客户身份购物 + 无法重新申请骑手）

**修复**：

```typescript
@Controller('api/v1/common/rider')
@Roles('customer')  // ← 加这一行
export class RiderApplicationController { ... }
```

**还需要核查**：CLAUDE.md 的 `deviceType` 校验是否在全局 Guard 中。如果只有 Roles Guard 没有 DeviceType Guard，client_app deviceType 的限制实际是审计而非强制，需要在文档/代码中明确这一点。

---

### 🟡 建议项（应该修复）

#### S1. `cart.service.ts:getCart` JSON.parse 没有 try-catch

**文件**：`apps/api/src/modules/cart/cart.service.ts:117`

```typescript
const cached = await redis.get(this.cacheKey(userId));
if (cached) {
  return JSON.parse(cached) as CartView;  // ❌ 无 try-catch
}
```

**问题**：
- 测试 `cart.service.test.ts:90-94` 验证了"格式坏抛错"的行为，但**生产环境** Redis 数据如果被外部污染（运维误操作 / 版本不兼容 / 序列化格式变更），用户购物车整个不可用
- 测试期望是"抛错"，但更好的行为是"降级到 DB"

**修复**：

```typescript
try {
  const cached = await redis.get(this.cacheKey(userId));
  if (cached) {
    return JSON.parse(cached) as CartView;
  }
} catch (e) {
  // 缓存损坏：降级到 DB，不阻塞用户
  logger.warn({
    msg: 'CART_CACHE_DESERIALIZE_FAILED',
    userId,
    error: (e as Error).message,
  });
}
// 继续走 DB 路径
```

---

#### S2. `dispatch.service.ts:acceptTask` 双 UPDATE 不在事务中

**文件**：`apps/api/src/modules/dispatch/dispatch.service.ts:123-163`

```typescript
// UPDATE 1：乐观锁 task
const result = await db.$executeRaw`UPDATE "delivery_tasks" SET ...`;
// ...
// UPDATE 2：同步 Order.riderId（不在同一事务）
await db.order.update({
  where: { id: task.orderId },
  data: { riderId: input.riderId },
});
```

**问题**：
两个 UPDATE 之间进程崩溃 → task.status=ASSIGNED 但 order.riderId=null。客户端订阅 `order:${orderId}` 拿到的 Order 数据没有骑手信息，需要等下一次状态推进（pickup）才能间接看到。

**修复**：

```typescript
await db.$transaction([
  db.$executeRaw`UPDATE "delivery_tasks" SET ...`,
  db.order.update({
    where: { id: task.orderId },
    data: { riderId: input.riderId },
  }),
]);
```

或用 `withTransaction(async (tx) => { ... })` 复用项目模式。

---

#### S3. `order.service.ts:cancelIfPending` 缺事件上下文

**文件**：`apps/api/src/modules/order/order.service.ts:408-439`

```typescript
async cancelIfPending(orderId: string, ctx: { reason: string; operatorId?: string }) {
  // ...
  await this.cancelOrderInternal(orderId, {
    operatorId: ctx.operatorId,
    reason: ctx.reason,
    // ❌ 没传 deviceType / perspective
  });
}
```

**问题**：
BullMQ 触发的取消进入 `cancelOrderInternal`，写 OrderEvent 时 `deviceType = undefined`，`toPrismaDeviceType(undefined)` 的行为未明（看 `order.types.ts` 实现）。审计表无法区分"系统自动取消"和"用户手动取消"。

**修复**：

```typescript
// OrderTimeoutProcessor.process 改为：
await this.orderService.cancelIfPending(orderId, {
  reason: 'ORDER_TIMEOUT_15MIN',
  operatorId: null,
  deviceType: 'admin_web',  // 或新增 'system' 枚举
  perspective: 'system',
});
```

并在 `cancelIfPending` 的 ctx 类型加上 `deviceType?` / `perspective?` 字段透传。

---

#### S4. `idempotency.service.ts` PENDING 状态可能死锁 24h

**文件**：`apps/api/src/shared/idempotency/idempotency.service.ts:104-126`

**问题**：
- 一个请求进入 withIdempotency → INSERT PENDING → 执行 fn
- fn 因为某种原因永远 hang 住（DB 连接死锁 / 第三方 API 超时无超时配置）
- 24h 内所有同 key 请求都会拿到 `IdempotencyConcurrentException`（409）
- 用户无法用同一个 key 重试，**必须前端换新 key** —— 但客户端通常不这么做

**修复建议**：
- 给 PENDING 状态加一个"短超时"（比如 5min）：超过则视为 stuck，自动清理 + 重建
- 或在 `handleExistingKey` 中检查 `createdAt` 而非仅 `expiresAt`

```typescript
private async handleExistingKey<T>(...) {
  const existing = await db.idempotencyKey.findUnique(...);
  if (!existing) return fn();

  const now = Date.now();
  const isExpired = existing.expiresAt < new Date();
  // 新增：PENDING 状态超过 5min 视为 stuck
  const isStuckPending = existing.status === 'PENDING'
    && now - existing.createdAt.getTime() > 5 * 60 * 1000;

  if (isExpired || isStuckPending) {
    await db.idempotencyKey.delete({ where: { id: existing.id } });
    return this.withIdempotency(scene as IdempotencyScene, key, fn);
  }
  // ...
}
```

---

#### S5. `dispatch.service.ts:reportIssue` 不写 OrderEvent + 不通知客服

**文件**：`apps/api/src/modules/dispatch/dispatch.service.ts:354-386`

**问题**：
骑手上报异常（CUSTOMER_UNREACHABLE / CUSTOMER_REJECTED 等）只更新 `task.status=FAILED`：
- ❌ 不写 `OrderEvent`：订单维度查不到异常记录，客服在订单详情页看不到
- ❌ 不 WS 推送给客服 room：客服不能实时介入
- ❌ Order.status 不变：订单停留在 PICKED/OUT_FOR_DELIVERY，没有 customer_service 介入的标志

**修复**：

```typescript
// 在 update task 之后加：
await db.orderEvent.create({
  data: {
    orderId: task.orderId,
    eventType: 'ISSUE_REPORTED',
    fromStatus: order.status,
    toStatus: order.status,
    operatorId: input.riderId,
    deviceType: 'rider_app',
    metadata: { reason: input.reason, note: input.note, taskId: input.taskId },
  },
});

// WS 推送到客服 room
this.realtime.server.to('customer-service').emit('dispatch:issue-reported', {
  taskId: input.taskId,
  orderId: task.orderId,
  reason: input.reason,
  note: input.note,
});
```

---

#### S6. `rider.service.ts` Redis 在线状态与 DB status 可能不一致

**文件**：`apps/api/src/modules/rider/rider.service.ts:188-256`

**问题场景**：
- 骑手调 `updateDuty(status=ONLINE)` → DB 更新成功 → Redis SET 失败（catch + warn）
- 此时 `profile.status=ONLINE` 但 `isOnline(riderId)=false`
- `getProfile` 返回 `{ status: 'ONLINE', isOnline: false }` —— 矛盾数据
- 反之也成立：Redis TTL 60s 到期自动失效，DB status 仍是 ONLINE

**修复**：
1. `toView` 时以 Redis 为准：`isOnline=false` 则强制 `status='OFFLINE'`
2. 或在 `getProfile` 末尾：`if (!isOnline && updated.status === 'ONLINE') { patchStatus('OFFLINE') }`

---

### 💭 小改进（锦上添花）

#### M1. `cart.service.ts:previewCheckout` 用动态 import 绕循环依赖

**文件**：`apps/api/src/modules/cart/cart.service.ts:339`

```typescript
const { findWarehouseByPoint } = await import('../../shared/db');
```

`shared/db` 不 import cart，没有循环依赖问题。改成文件顶部静态 import 即可：

```typescript
import { db, findWarehouseByPoint } from '../../shared/db';
```

动态 import 在 NestJS 的 startup 阶段会引入一次延迟（首次调用），并且代码可读性差。

---

#### M2. `order.controller.ts` Idempotency-Key header 无格式校验

**文件**：`apps/api/src/modules/order/order.controller.ts:87`

`@Headers('idempotency-key')` 接受任意字符串。建议用 pipe 校验为 UUID 或最小长度：

```typescript
const IdempotencyKeyHeader = z.string().uuid().optional();
// 或 z.string().min(8).max(64).optional();
```

避免客户端传 "1" / "test" 这种无意义 key 占用 IdempotencyKey 表空间。

---

#### M3. `dispatch.controller.ts:acceptTask` 等端点 taskId 未做 UUID 校验

**文件**：`apps/api/src/modules/dispatch/dispatch.controller.ts:78`

`@Param('id') id: string` 接受任意字符串。如果客户端传非 UUID，Prisma `$executeRaw` 会报错（不会执行），但日志会噪声化。

修复：`@Param('id', new ParseUUIDPipe())` 在所有 rider/admin 端点的 :id 参数上加。

---

#### M4. `rider.service.ts:heartbeat` 不校验 APPROVED 状态

**文件**：`apps/api/src/modules/rider/rider.service.ts:261-273`

PENDING/REJECTED 状态的骑手也能心跳，污染"在线骑手"列表。建议：

```typescript
async heartbeat(riderId: string): Promise<{ renewed: boolean }> {
  const profile = await db.riderProfile.findUnique({ where: { userId: riderId } });
  if (!profile || profile.applicationStatus !== 'APPROVED') {
    return { renewed: false };
  }
  // ... 续期逻辑
}
```

注意：每次心跳查 DB 会增加 QPS，可改成首次心跳查 DB + 后续只 SET Redis（依赖前端保证状态正确）。

---

#### M5. `cart.service.ts:addItem` 缺数量上限

**文件**：`apps/api/src/modules/cart/cart.service.ts:168`

用户可以一次加购 quantity=100000，库存在结算时才校验。建议：
- 单次 quantity ≤ 99
- 购物车总 item 数 ≤ 50
- 防止恶意刷接口或 UI bug 累加无限制

---

#### M6. `rider.service.ts:review` APPROVED 时抹掉 rejectReason（审计损失）

**文件**：`apps/api/src/modules/rider/rider.service.ts:166`

```typescript
rejectReason: input.decision === 'REJECTED' ? input.rejectReason : null,
```

当前安全（因为 review 只允许 PENDING 状态被 review，一旦 REJECTED 不能再 review），但如果未来加了"重新审核"功能，APPROVED 会抹掉历史 reason。建议改为：仅在数据从 null → 非 null 时写入，不主动 nullify：

```typescript
rejectReason: input.decision === 'REJECTED' ? input.rejectReason : profile.rejectReason,
```

---

#### M7. `idempotency.service.ts:handleExistingKey` 递归无深度限制

**文件**：`apps/api/src/shared/idempotency/idempotency.service.ts:118`

理论风险：delete 失败的极端场景下递归会无限循环。建议加递归深度参数（默认 max=3）。

---

### ✅ 做得好的地方

1. **乐观锁抢单设计**（`dispatch.service.ts:123-131`）：
   - 用 `UPDATE...WHERE status='PENDING_ASSIGN'` 原子操作避免 SELECT FOR UPDATE
   - 返回 0 行时清晰区分"任务不存在"vs"已被抢"，错误码 E-DISPATCH-001 vs E-DISPATCH-002
   - 这是处理并发抢单最优雅的方案，比悲观锁性能高一个数量级

2. **IdempotencyKey 完整生命周期**（`idempotency.service.ts`）：
   - 4 状态覆盖：PENDING / SUCCESS / FAILED / EXPIRED（基于 expiresAt）
   - write-through 模式，fn 失败时正确标 FAILED 透传原错误
   - 单测 9 个覆盖所有分支，包括 EXPIRED 递归重建的边界

3. **BullMQ 任务设计**（`order-timeout.helper.ts`）：
   - `jobId: order-timeout:${orderId}` 利用 BullMQ 内置去重，同 orderId 重复入队自动合并
   - `attempts: 3` + 指数退避（5s 起步）+ `removeOnComplete: 100` + `removeOnFail: 200`
   - Redis 不可用时 catch + 降级，不阻塞下单（兜底走 cron）

4. **WS 广播容错一致**（`dispatch.service.ts:173-184, 227-239, 333-346, 451-470`）：
   - 所有 `realtime.server.to().emit()` 都 try-catch + warn，WS 宕机不阻塞业务
   - 日志结构化（msg + taskId + error），便于 Sentry 追踪

5. **错误码体系一致**：
   - 所有 ConflictException/NotFoundException 用 `{ code, message, details? }` 格式
   - 配合 i18n filter 自动本地化，前端只需查 code → i18n key
   - 错误码段位严格在 §3.4 C 流程范围（E-DISPATCH-001~005, E-RIDER-001~006, E-CART-001~004）

6. **Cart Redis 缓存层容错**（`cart.service.ts:81-109`）：
   - `invalidateCache` / `setCache` 都 catch + warn，Redis 宕机不阻塞业务
   - 写后失效策略简单可靠（先 DEL，下次读自动回填）

7. **测试覆盖关键路径**：
   - idempotency 9 测 + cart 14 测 + order 8 测
   - 覆盖 success / failure / concurrent / boundary 四类场景
   - mock 设计干净，`vi.hoisted` 解决了 Prisma 命名空间的 mock 难题

8. **类型安全的 toView 转换**（`dispatch.service.ts:482-512, order.service.ts:641-715`）：
   - Decimal → number、Date → ISO 字符串统一处理
   - Prisma `GetPayload<>` 类型推导，避免手写 interface 偏差

9. **DI 解耦模式**（`order.module.ts` + `dispatch.module.ts`）：
   - `DISPATCH_SERVICE_TOKEN` Symbol + `DispatchServiceLike` 接口
   - Order 依赖接口而非具体类，便于单测 mock（`order.service.test.ts:108` 直接传 null）
   - 显式声明 `{ provide, useExisting }` 规避 tsx esbuild metadata 限制

10. **migration 设计**（`migration.sql`）：
    - 用 TEXT 而非 enum，规避与 W/M 流程的 enum migration 撞
    - 加索引 `idx_rider_profiles_application_status` 优化 admin 审核列表查询
    - 字段命名遵循 snake_case 数据库列名 + camelCase Prisma 字段映射的项目规范

---

### 📊 评分

| 维度 | 评分 (1-10) | 说明 |
|------|------------|------|
| 正确性 | **6** | clearOrderedItems 死代码是严重业务回归（B1）；其他流程正确；reportIssue 不写事件是审计缺口（S5） |
| 安全性 | **7** | apply 端点缺 @Roles 是鉴权缺口（B2）；其余 RBAC + 乐观锁到位；SQL 参数化绑定正确 |
| 可维护性 | **8** | 注释充分、决策依据可追溯；动态 import（M1）和递归无深度限制（M7）是小遗憾 |
| 性能 | **8** | Redis 缓存 + 乐观锁 + BullMQ delayed job 设计良好；cart 缓存命中可避免 DB 查询 |
| 测试覆盖 | **7** | idempotency/cart/order service 单测到位；但 dispatch/rider service 0 单测，无 e2e |

**整体均分：7.2/10**

---

### 🎯 修复优先级

**进入 W4 前必修（阻断 W4 联调）**：
- 🔴 B1 `clearOrderedItems` 接入 OrderService（业务回归，影响真实用户）
- 🔴 B2 apply 端点加 `@Roles('customer')`（鉴权缺口）

**W4 内修复**：
- 🟡 S1 cart JSON.parse 加 try-catch
- 🟡 S2 acceptTask 双 UPDATE 包事务
- 🟡 S3 cancelIfPending 传 deviceType/perspective
- 🟡 S5 reportIssue 写 OrderEvent + WS 推客服
- 🟡 S6 rider Redis 在线状态一致性

**W5+ 或重构时改进**：
- 💭 M1-M7 全部归入技术债清单

**测试补强**：
- 补 dispatch.service 单测（抢单并发 / pickup/deliver 状态机 / reportIssue）
- 补 rider.service 单测（入驻 / 审核 / 上下班）
- 至少 1 个 e2e：下单 → 支付 mock callback → CONFIRMED → 抢单 → 取货 → 送达全链路

---

### 📌 给主 AI 整合时的提示

1. **B1 / B2 必须在整合到 main 前修复**，否则 W4 联调会出现"下单后购物车没清空"和"非 customer 角色申请骑手"两个明显问题
2. `clearOrderedItems` 修复时需要新增 `CART_SERVICE_TOKEN` + `CartServiceLike` 接口（参考 `DISPATCH_SERVICE_TOKEN` 模式），避免 Order ↔ Cart 循环依赖
3. 修复 B2 时同步检查全局 Guard 的兜底行为：CLAUDE.md 说"后端 RBAC 不感知 perspective，只看 role"，但要确认未标 `@Roles` 的 Controller 是否真的拒绝访问（而非放行）
4. 整合时跑 `pnpm --filter @meimart/api test` 应该 138 测试全过；修复 B1 后需要新增至少 1 个测试验证"createOrder 后 cart 被清空"

---

**审查员签字**：代码审查员（GLM-5.2[1M]，Claude Code harness）
**报告版本**：v1.0
**主 AI 整合时**：按"修复优先级"逐项推进，B1/B2 阻断 W4 启动
