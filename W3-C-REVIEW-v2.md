# 流程 C 第二轮代码审查报告（修复质量 + 漏网之鱼）

**审查范围**：第一轮报告驱动的 5 个 fix commit（`ea0e5f9` → `c56e2f2` → `e17aed2`）
**审查时间**：2026-06-26（Asia/Dili）
**审查员**：代码审查员（GLM-5.2，Claude Code harness）
**审查基准**：`w3-flow-c` HEAD = `e17aed2`
**对照文件**：`W3-C-REVIEW.md`（第一轮）+ `W3-C-MANIFEST.md` v1.1 §9

---

## 📋 第二轮审查报告

### 总体印象

第一轮提出的 15 个问题（B1/B2/S1-S6/M1-M7）**全部修复**，并补了 34 个 service 单测 + 1 个全链路集成测试，工作量和态度值得肯定。但**修复质量参差不齐**：

- **修复正确**：B1 / B2 / S1 / S2 / S3 / S5 / M1 / M3 / M4 / M5（10 项）
- **修复但有 bug**：🔴 **M7 递归深度限制完全无效**（深度参数被吞掉）
- **修复不彻底**：🟡 **S5 / S6 同类问题未全覆盖**（reportIssue 没包事务、getProfile 不写 DB）
- **修复无实际效果**：💭 M6（业务路径根本走不到）
- **修复引入新风险**：🟡 M2（非 UUID 静默降级 = 失去幂等保护）

另外发现 **4 个第一轮没提到的漏网之鱼**（schema drift / FK 缺失 / BullMQ keyPrefix / e2e 测试分段拼接）。

**评分调整**：7.2 → 7.6（修复显著提升了正确性，但 M7 和漏网问题拉低了分数）

---

### 🏗️ 修复质量逐项验证

| 原问题 | 修复 Commit | 修复状态 | 验证结论 |
|---|---|---|---|
| 🔴 B1 clearOrderedItems 死代码 | ea0e5f9 | ✅ 正确 | CART_SERVICE_TOKEN 模式 + 容错 + 测试验证 |
| 🔴 B2 apply 无 @Roles | ea0e5f9 | ✅ 正确 | 加 `@Roles('customer')`，功能解锁 |
| 🟡 S1 cart JSON.parse 无 try-catch | 31fb6ac | ✅ 正确 | 缓存损坏降级 DB + 日志 |
| 🟡 S2 acceptTask 双 UPDATE 不事务 | 31fb6ac | ✅ 正确 | `withTransaction` 包裹，加 status 前置校验 |
| 🟡 S3 cancelIfPending 缺事件上下文 | 31fb6ac | 🟡 半正确 | 透传了，但 `deviceType='admin_web'` 语义混淆 |
| 🟡 S4 Idempotency stuck-pending | 31fb6ac | 🟡 半正确 | stuck 检测加了，但与 M7 联动有 bug |
| 🟡 S5 reportIssue 不写事件 | 31fb6ac | 🟡 不彻底 | 加了 OrderEvent，但**没包事务**（同 S2 类问题） |
| 🟡 S6 rider Redis/DB 一致性 | 79ad3dc | 🟡 不彻底 | 只在 getProfile 出口修正，**不 UPDATE DB** |
| 💭 M1 动态 import | 79ad3dc | ✅ 正确 | 改静态 import |
| 💭 M2 Idempotency-Key 格式校验 | 79ad3dc | 🟡 引入新风险 | 非 UUID 静默降级失去幂等保护 |
| 💭 M3 :id 加 ParseUUIDPipe | 79ad3dc | ✅ 正确 | 4 端点全部加上 |
| 💭 M4 heartbeat 校验 APPROVED | 79ad3dc | ✅ 正确 | 加了 DB 校验 |
| 💭 M5 addItem 数量上限 | 79ad3dc | ✅ 正确 | 加 ≤ 99 限制 |
| 💭 M6 review 保留 rejectReason | 79ad3dc | 🟡 无效 | 业务路径走不到（review 已拦截非 PENDING） |
| 💭 M7 递归深度限制 | 79ad3dc | 🔴 **完全无效** | depth 参数被吞掉，详见下方 |

---

### 🔴 阻塞项（必须修复）

#### V2-B1. M7 递归深度限制**完全无效** — 修复引入死代码

**文件**：`apps/api/src/shared/idempotency/idempotency.service.ts:110-160`

**问题**：
M7 的目的是限制 `handleExistingKey` 的递归深度，防止 delete 失败导致无限循环。代码：

```typescript
private async handleExistingKey<T>(
  scene: string,
  key: string,
  fn: () => Promise<T>,
  depth = 0,   // ← 默认 0
): Promise<T> {
  if (depth >= 3) {                        // 检查 1：depth=0 → 不触发
    throw new IdempotencyConcurrentException(...);
  }
  // ...
  if (isExpired || isStuckPending) {
    await db.idempotencyKey.delete({ ... });
    return this.withIdempotency(scene, key, fn);
    //                           ↑↑↑ 没传 depth！
    //                           withIdempotency 不接收 depth 参数
  }
}
```

`withIdempotency` 签名（line 58）是 `(scene, key, fn)`，**没有 depth 参数**。它内部调 `handleExistingKey(scene, key, fn)`（line 75）也没传 depth，所以 `depth = 0` 默认值生效。

**实际递归路径**：
```
handleExistingKey(depth=0) → delete → withIdempotency()
  → create() 失败 P2002 → handleExistingKey(depth=0)   ← 永远是 0
    → delete → withIdempotency()
      → create() 失败 P2002 → handleExistingKey(depth=0)
        → ... 无限循环
```

`if (depth >= 3)` 永远不会满足（depth 永远是 0）。

**触发条件**：
- DB delete 持续失败（如 Redis 暂时不可用但 prisma 连接 OK 时，delete 因事务冲突反复失败）
- 这种场景虽罕见但**生产有可能**（DB 主从切换 / 连接池耗尽）

**影响**：栈溢出崩溃 / Node 进程 OOM / 整个 API 实例不可用

**修复**（两种方案任选）：

**方案 A**：让 `withIdempotency` 接收 depth 并透传：

```typescript
async withIdempotency<T>(
  scene: IdempotencyScene,
  key: string | undefined,
  fn: () => Promise<T>,
  depth = 0,                           // ← 新增
): Promise<T> {
  if (!key) return fn();
  // ... create ...
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return this.handleExistingKey(scene, key, fn, depth);  // ← 透传
    }
    throw e;
  }
}

// handleExistingKey 内部递归改成：
return this.withIdempotency(scene as IdempotencyScene, key, fn, depth + 1);
//                                                                  ↑↑↑ 关键
```

**方案 B**：直接递归调 `handleExistingKey`，不走 `withIdempotency`：

```typescript
if (isExpired || isStuckPending) {
  await db.idempotencyKey.delete({ ... });
  // 递归调自己，depth+1
  return this.handleExistingKey(scene, key, fn, depth + 1);
  // 但这跳过了 INSERT PENDING 步骤，需要重写为：
  // 1. 尝试 create（再次 INSERT）
  // 2. 成功 → 执行 fn
  // 3. 失败 → handleExistingKey(depth+1)
}
```

方案 A 更接近原意，推荐。

**测试缺失**：
当前 `idempotency.service.test.ts` 没有测试递归深度限制（即使写了测试，因为代码本身无效，测试也不会发现）。修复后必须加：

```typescript
it('delete 连续失败 3 次 → 抛 RECURSION_LIMIT 异常', async () => {
  mockDb.idempotencyKey.create
    .mockRejectedValueOnce(uniqueViolation())  // 首次 create 撞 unique
    .mockRejectedValueOnce(uniqueViolation())  // delete 后再 create 撞
    .mockRejectedValueOnce(uniqueViolation())  // 再 delete 再 create 撞
    .mockRejectedValueOnce(uniqueViolation()); // 第 4 次
  mockDb.idempotencyKey.findUnique.mockResolvedValue({
    status: 'PENDING',
    expiresAt: new Date(Date.now() - 60_000),  // 过期 → 触发 delete
    createdAt: new Date(Date.now() - 120_000),
  });
  mockDb.idempotencyKey.delete.mockResolvedValue({});  // delete 成功
  const fn = vi.fn();
  await expect(service.withIdempotency('ORDER_CREATE', 'k', fn))
    .rejects.toThrow(/RECURSION_LIMIT/);
});
```

---

### 🟡 建议项（应该修复）

#### V2-S1. reportIssue 双 DB 写操作未包事务（S5 同类漏网）

**文件**：`apps/api/src/modules/dispatch/dispatch.service.ts:393-421`

```typescript
const updated = await db.deliveryTask.update({ ... });   // UPDATE 1
await db.orderEvent.create({ ... });                      // INSERT 2（不在事务中）
```

**问题**：
第一轮 S2 同类问题已修（acceptTask），但 reportIssue **没修**。两个 DB 写操作分开，进程崩溃会出现 task.status=FAILED 但 OrderEvent 缺失。OrderEvent 是审计核心，缺失后客服在订单详情页看不到异常上报。

**修复**：

```typescript
const { updated } = await withTransaction(async (tx: Tx) => {
  const updated = await tx.deliveryTask.update({
    where: { id: input.taskId },
    data: { status: 'FAILED', note: ... },
    include: { ... },
  });
  await tx.orderEvent.create({
    data: {
      orderId: task.orderId,
      eventType: 'ISSUE_REPORTED',
      // ...
    },
  });
  return { updated };
});
```

---

#### V2-S2. reportIssue 缺状态前置校验

**文件**：`apps/api/src/modules/dispatch/dispatch.service.ts:381-391`

当前只校验 task 存在 + riderId owner，**没校验 task.status**：

```typescript
async reportIssue(input: ReportIssueInput): Promise<DeliveryTaskView> {
  const task = await db.deliveryTask.findUnique({ where: { id: input.taskId } });
  if (!task) throw new NotFoundException(...);
  if (task.riderId !== input.riderId) throw new ConflictException(...);
  // ❌ 没校验 task.status
  // 直接 update 把 status 改为 FAILED
}
```

**问题**：
- task.status=DELIVERED（已送达）→ 骑手仍能调 reportIssue 标 FAILED，订单回退到异常状态
- task.status=FAILED（已失败）→ 骑手能反复调 reportIssue，覆盖原 note
- task.status=PENDING_ASSIGN（还没抢）→ 任务还没分配，"异常上报"语义上不对

**修复**：

```typescript
const ALLOWED_STATUSES_FOR_ISSUE = ['ASSIGNED', 'PICKED_UP', 'DELIVERING'];
if (!ALLOWED_STATUSES_FOR_ISSUE.includes(task.status)) {
  throw new ConflictException({
    code: 'E-DISPATCH-004',
    message: `Task status ${task.status} cannot report issue (only ${ALLOWED_STATUSES_FOR_ISSUE.join('/')} allowed)`,
  });
}
```

---

#### V2-S3. S6 修复不彻底 — getProfile 只改返回值不 UPDATE DB

**文件**：`apps/api/src/modules/rider/rider.service.ts:300-308`

```typescript
let consistentStatus = profile.status;
if ((consistentStatus === 'ONLINE' || consistentStatus === 'BUSY') && !isOnline) {
  consistentStatus = 'OFFLINE';
}
return this.toView({ ...profile, status: consistentStatus }, isOnline);
//                              ↑ 只在内存修改，DB 还是 ONLINE
```

**问题**：
- 客户端调 `getProfile` → 收到 `{ status: 'OFFLINE' }` ✓
- DB 中 `rider_profiles.status` 仍是 `'ONLINE'`
- admin 调"在线骑手列表"接口（如 `findMany({ where: { status: 'ONLINE' } })`）会返回这个不一致的骑手
- 客户端视角正确，**admin 视角错误**

**修复**：

```typescript
if ((profile.status === 'ONLINE' || profile.status === 'BUSY') && !isOnline) {
  // 检测到不一致 → 修正 DB（异步，不阻塞响应）
  db.riderProfile.update({
    where: { userId: riderId },
    data: { status: 'OFFLINE' },
  }).catch((e) => logger.warn({
    msg: 'RIDER_STATUS_RECONCILE_FAILED',
    riderId,
    error: (e as Error).message,
  }));
  return this.toView({ ...profile, status: 'OFFLINE' }, false);
}
return this.toView(profile, isOnline);
```

或更彻底的方案：跑定时 worker 每分钟扫一遍 Redis vs DB 一致性（适合骑手量大时）。

---

#### V2-S4. M2 修复引入新风险 — 非 UUID 静默降级失去幂等保护

**文件**：`apps/api/src/modules/order/order.controller.ts:97-101`

```typescript
const idempotencyKeyParsed = IdempotencyKeyHeader.safeParse(rawIdempotencyKey);
const idempotencyKey = idempotencyKeyParsed.success
  ? idempotencyKeyParsed.data
  : undefined;
//                           ↑↑↑ 非 UUID 静默变 undefined
```

**问题**：
客户端本意是用幂等键防重复下单，但因为格式错误（比如传了 "abc"），**默默失去幂等保护**，重复请求会真实扣库存。

**用户场景**：
- 前端 bug：generateUuid() 失败返回空字符串 → idempotency-key="abc"
- 客户端预期：服务端拒绝并提示格式错误
- 实际行为：服务端静默跳过幂等保护，重复下单扣两次库存

**修复**（两种思路任选）：

**思路 A**：严格模式 — 非 UUID 直接 400：
```typescript
const result = IdempotencyKeyHeader.safeParse(rawIdempotencyKey);
if (rawIdempotencyKey && !result.success) {
  throw new BadRequestException({
    code: 'E-COMMON-001',
    message: 'idempotency-key header must be a valid UUID',
  });
}
const idempotencyKey = result.data;
```

**思路 B**：兜底模式 — 非 UUID 时服务端自己生成：
```typescript
const idempotencyKey = idempotencyKeyParsed.success
  ? idempotencyKeyParsed.data
  : crypto.randomUUID();  // 兜底生成
```

思路 A 更安全（暴露客户端 bug 而非掩盖），推荐。

---

#### V2-S5. S3 用 admin_web 表达"系统操作"语义混淆

**文件**：`apps/api/src/modules/order/order.service.ts:462-463`

```typescript
deviceType: 'admin_web',    // S3 修复：用现有值表达"系统后台操作"
perspective: 'system',
```

**问题**：
OrderEvent 表记录 `deviceType=ADMIN_WEB + perspective=system`，但实际**没有任何 admin_web 设备发起此操作**。运维查 AuditLog 看到 `deviceType=ADMIN_WEB`：

- 误以为是某管理员手动操作（实际是 BullMQ 触发的自动取消）
- 安全审计场景可能误判为"admin 越权操作"
- 统计"管理员操作频率"会算错

**修复**（任选一种）：

**方案 A**：扩展 DeviceType 枚举（推荐）：
```prisma
enum DeviceType {
  CLIENT_APP
  RIDER_APP
  ADMIN_WEB
  SYSTEM       // 新增
}
```
然后 `deviceType: 'SYSTEM'`，前端 i18n 加 SYSTEM 翻译为"系统"。

**方案 B**：OrderEvent 加 `triggerSource` 字段：
```prisma
model OrderEvent {
  // ...
  triggerSource String @default("USER")  // USER / SYSTEM / CRON / BULLMQ
}
```

---

#### V2-S6. Schema 与 migration 不一致 — `applicationStatus` 可空性

**文件**：
- `apps/api/prisma/schema.prisma:686`：`applicationStatus String? @default("PENDING")` （**可空**）
- `apps/api/prisma/migrations/20260625000000_add_rider_application_c/migration.sql:8`：`TEXT NOT NULL DEFAULT 'PENDING'` （**非空**）

**问题**：
- Prisma 客户端生成的类型基于 schema → `applicationStatus: string | null`
- DB 实际 NOT NULL → 永远不会是 null
- `rider.service.ts:341` 用 `?? 'PENDING'` 兜底（防御性代码），实际触发不到
- 这是 schema drift，长期会让代码类型与 DB 实际不一致

**修复**：

```prisma
// schema.prisma RiderProfile
applicationStatus String @default("PENDING") @map("application_status")
//            ↑↑ 去掉问号
```

同步简化 `rider.service.ts`：
```typescript
applicationStatus: p.applicationStatus as ApplicationStatus,
//                ↑ 去掉 ?? 'PENDING'
```

并跑 migration 让 schema 与 DB 对齐（如果 schema 改成 NOT NULL，prisma migrate diff 会生成空 migration，确认无变更后跳过即可）。

---

#### V2-S7. `reviewed_by_id` 缺 FK 约束 — 数据完整性问题

**文件**：`apps/api/prisma/schema.prisma:688` + migration `20260625000000_add_rider_application_c/migration.sql:10`

**问题**：
schema 中 `reviewedById String? @map("reviewed_by_id")` 是个"裸字符串"，没有 Prisma relation 约束；migration 也没加 FK。

```prisma
model RiderProfile {
  // ...
  reviewedById String? @map("reviewed_by_id")
  // ❌ 没有：user User? @relation("ReviewedRiders", fields: [reviewedById], references: [id])
}
```

**风险**：
- admin 被硬删除（如离职清理账号），`reviewed_by_id` 不会级联，留下"悬空指针"
- 无法通过 `include: { reviewedBy: true }` 关联查询审核人信息
- 审计场景需要 admin 名字时必须手动 join

**修复**：

1. schema 加 relation：
```prisma
model RiderProfile {
  // ...
  reviewedById String? @map("reviewed_by_id")
  reviewedBy   User?   @relation("ReviewedRiders", fields: [reviewedById], references: [id], onDelete: SetNull)
}

model User {
  // ...
  reviewedRiders RiderProfile[] @relation("ReviewedRiders")
}
```

2. 新建 migration 加 FK：
```sql
ALTER TABLE "rider_profiles"
  ADD CONSTRAINT "fk_rider_profiles_reviewed_by_id"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL;
```

---

#### V2-S8. BullMQ 与业务 cache 复用同一 keyPrefix

**文件**：
- `apps/api/src/shared/queue/queue.module.ts:24`：`keyPrefix: 'meimart:'`
- `apps/api/src/shared/cache/redis.ts:31`：`keyPrefix: 'meimart:'`

**问题**：
理论上 BullMQ 内部 key 格式是 `<keyPrefix>:bull:<queueName>:...`，业务 cache 是 `<keyPrefix>:cart:xxx`，不会撞 key。但：

1. **运维风险**：跑 `redis-cli --scan --pattern 'meimart:*' | xargs redis-cli del` 清缓存时，会**误删所有 BullMQ 队列任务**（订单超时取消任务全没了）
2. **隔离性差**：BullMQ 故障（如大量 failed job 堆积）和业务 cache 故障无法独立清理
3. **W3-C manifest §8 提到的多实例部署风险**：复用同一 Redis 实例 + 同一 keyPrefix 让多实例扩展时缺乏物理隔离

**修复**（任选一种）：

**方案 A**（推荐，简单）：BullMQ 用独立 keyPrefix：
```typescript
// queue.module.ts
BullModule.forRoot({
  connection: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    keyPrefix: 'bull:',  // ← 改成独立的
  },
})
```

**方案 B**：BullMQ 用独立 Redis 实例（最佳隔离，需运维支持）：
```typescript
BullModule.forRoot({
  connection: {
    url: process.env.REDIS_BULLMQ_URL ?? process.env.REDIS_URL,
    // W3 单实例够用，W4+ 切独立实例
  },
})
```

---

### 💭 小改进（锦上添花）

#### V2-M1. M6 修复在当前业务路径下无实际效果

**文件**：`apps/api/src/modules/rider/rider.service.ts:166-170`

```typescript
rejectReason:
  input.decision === 'REJECTED'
    ? input.rejectReason
    : profile.rejectReason,   // M6：APPROVED 时保留原 reason
```

**分析**：
review 方法（line 146-151）已拦截：
```typescript
if (profile.applicationStatus !== 'PENDING') {
  throw new ConflictException({ code: 'E-RIDER-004', ... });
}
```

意味着只有 `applicationStatus='PENDING'` 的记录能被 review，而 PENDING 记录的 `rejectReason` 永远是 null（apply 时没设置）。所以：
- 首次 review APPROVED → 保留 null（与原代码行为一致）
- 首次 review REJECTED → 写入 reason
- "先 REJECTED 再 APPROVED 保留 reason" 这个 M6 想保护的场景，业务流根本走不到

**结论**：
M6 代码正确但**在当前业务约束下永远走不到"保留非 null reason"分支**。需要等未来加了"重新审核"功能（PENDING → REJECTED → PENDING-AGAIN → APPROVED）才有意义。

**建议**：
保留代码（未来用得上），但在 commit message 或注释中明确"本修复预防未来'重新审核'功能的语义丢失，当前业务路径下行为与原代码一致"。当前 commit 已写了类似说明，OK。

---

#### V2-M2. e2e 测试是"分段拼接"而非真正端到端

**文件**：`apps/api/tests/order-dispatch.integration.test.ts:286-353`

**问题**：
测试注释说"覆盖 下单 → 支付 → CONFIRMED → 抢单 → 取货 → 送达 全链路"，但实际是**两段拼接**：

```typescript
// === 3. 支付 mock callback → markPaid → CONFIRMED ===
await orderService.markPaid('order-1', { ... });

// 第 296 行注释：
// "dispatch.createTaskForOrder 应被调（markPaid 内部）"
// "因为 mockDb.order.findUnique 的 include 不真返 warehouse，createTask 会抛"
// "我们用 expect 错误日志来验证，不阻塞主流程"

// 第 308 行：
// === 4. 手动调 dispatch.createTaskForOrder（模拟 markPaid 内部调用）===
mockDb.order.findUnique.mockImplementation(...);  // 重新 setup mock
const task = await dispatchService.createTaskForOrder('order-1');  // 再调一次
```

`markPaid` 内部调 `createTaskForOrder` 时**因为 mock 不全抛错被 catch**（line 573-583 的 try-catch 兜底），然后测试**重新 setup mock 再手动调一次**。这意味着：

- 测试**没有真正验证** `markPaid → createTaskForOrder` 的集成
- 只验证了"两个 service 独立工作都正常"
- 真实运行时如果 markPaid 内部 createTask 出错，本测试不会发现

**修复**：

要么：
1. 完善 `mockDb.order.findUnique` 的 include 行为，让 markPaid 内部调 createTaskForOrder 时不抛错，然后**只调 markPaid 一次**，断言 task 被创建
2. 或加注释明确"本测试是 service 级集成，不是端到端"，并补一个真正的 e2e（用 testcontainers 起真实 postgres+redis）

---

#### V2-M3. e2e 测试 setup 过度复杂

**文件**：`apps/api/tests/order-dispatch.integration.test.ts:14-200`

**问题**：
- 文件 200+ 行 setup（mockImplementation 重新定义 3 次 mockDb.order.findUnique）
- 后续维护时改一个 mock 要同步改 3 处
- 测试断言依赖内部实现细节（`mockDb._tables.orders.get('order-1')`）

**建议**：
- 抽 helper：`createMockOrder(data)` / `createMockTask(data)` 集中管理 mock 数据
- 用 `beforeEach` 重置 `_tables` 而非手动清空
- 断言改为通过 service API 验证（`orderService.getOrderDetail` 而非 `mockDb._tables.orders.get`）

---

#### V2-M4. IdempotencyConcurrentException 失败时无 retry-after header

**文件**：`apps/api/src/shared/idempotency/idempotency.service.ts:44-51`

```typescript
export class IdempotencyConcurrentException extends ConflictException {
  constructor(scene: string, key: string, status: string) {
    super({
      code: 'E-COMMON-009',
      message: `Idempotency key ${scene}:${key} already ${status}`,
    });
  }
}
```

**问题**：
PENDING 状态抛 409 时，前端拿到 "already PENDING" 不知道**等多久才能重试**。合理行为是返回 `Retry-After` header 或在 response body 里给 `estimatedWaitMs`。

**修复**：

```typescript
export class IdempotencyConcurrentException extends ConflictException {
  constructor(scene: string, key: string, status: string, retryAfterMs?: number) {
    super({
      code: 'E-COMMON-009',
      message: `Idempotency key ${scene}:${key} already ${status}`,
      retryAfterMs: retryAfterMs ?? 5_000,  // PENDING 时建议 5s 后重试
    });
  }
}
```

---

### ✅ 第二轮做得好的地方（修复亮点）

1. **B1 clearOrderedItems 接入优雅**（`order.module.ts:25, 35`）：
   - 用 `CART_SERVICE_TOKEN` + `CartServiceLike` 接口隔离循环依赖（仿 DISPATCH_SERVICE_TOKEN 模式）
   - `forwardRef(() => CartModule)` 处理 NestJS 双向引用
   - 容错为 null（单测不必传），生产注入真实实例
   - catch + warn 不阻塞下单（订单已成功，购物车清空失败用户可手动处理）

2. **B2 修复后 RolesGuard 行为正确**（`rider.controller.ts:69-70`）：
   - 加 `@Roles('customer')` 后端点解锁
   - 与 DeviceTypeGuard 配合：customer role + client_app deviceType 才能调 apply
   - 同时满足"client_app 登录后申请"的设计意图

3. **S2 acceptTask 事务化彻底**（`dispatch.service.ts:122-172`）：
   - 先轻量 SELECT 拿 orderId + 状态前置校验（提前抛 E-DISPATCH-002）
   - `withTransaction` 包裹乐观锁 UPDATE + order.update
   - UPDATE 返回 0 行时清晰区分"已被抢"路径
   - 双重防护：先 status 校验 + 后乐观锁 WHERE 子句

4. **S4 stuck-pending 检测设计合理**（`idempotency.service.ts:134-152`）：
   - 5min 阈值是合理工程取舍（业务 fn 99% 在 5min 内完成）
   - 区分 expired vs stuck-pending 给运维不同告警
   - 清理 + 重建 + 重试的流程符合幂等语义
   - 唯一遗憾是和 M7 联动有 bug（V2-B1）

5. **测试补强覆盖度大幅提升**：
   - 原 138 测试 → 现 173 测试（+35）
   - dispatch.service 0→17 测：抢单并发 / 状态机 / reportIssue 全覆盖
   - rider.service 0→17 测：入驻 / 审核 / 上下班 / 心跳全覆盖
   - 集成测试 0→1：覆盖 Order→Dispatch 完整业务流

6. **修复 commit 粒度合理**：4 个语义化 commit（P0/P1/P2/tests/e2e），便于回滚和 review

---

### 📊 第二轮评分

| 维度 | 第一轮 | 第二轮 | 变化 | 说明 |
|------|--------|--------|------|------|
| 正确性 | 6 | **8** | +2 | B1/B2/S1/S2 修复大幅提升；M7 死代码拉低 |
| 安全性 | 7 | **8** | +1 | B2 apply 锁定 customer；M3 UUID 校验到位；reviewed_by FK 缺失拉低 |
| 可维护性 | 8 | **8** | 0 | 修复代码注释充分；e2e 测试复杂度增加抵消收益 |
| 性能 | 8 | **8** | 0 | 无性能改动 |
| 测试覆盖 | 7 | **8.5** | +1.5 | +35 service 单测 + 1 集成测试；e2e 分段拼接扣分 |

**整体均分：7.7/10**（第一轮 7.2，提升 0.5）

修复显著提升了正确性和测试覆盖，但 M7 完全无效、S5/S6 不彻底、reviewed_by FK 缺失、e2e 分段拼接等问题让提升没有达到 8+ 的"良好"水平。

---

### 🎯 第二轮修复优先级

**主 AI 整合前必修**：
- 🔴 **V2-B1** M7 递归深度限制死代码（修改 + 加测试）
- 🟡 **V2-S1** reportIssue 双写包事务（同 S2 模式）
- 🟡 **V2-S6** schema applicationStatus 改 NOT NULL（对齐 migration）

**W4 联调前修复**：
- 🟡 **V2-S2** reportIssue 状态前置校验
- 🟡 **V2-S3** S6 一致性写 DB（修 reconciliation）
- 🟡 **V2-S4** M2 非 UUID 严格拒绝（防失去幂等保护）
- 🟡 **V2-S7** reviewed_by_id 加 FK 约束

**W5+ 或运维阶段处理**：
- 🟡 **V2-S5** DeviceType 枚举加 SYSTEM
- 🟡 **V2-S8** BullMQ 独立 keyPrefix
- 💭 **V2-M2** e2e 测试改真正端到端（testcontainers）
- 💭 **V2-M3** e2e setup 重构
- 💭 **V2-M4** IdempotencyConcurrentException 加 retryAfterMs

**测试补强**：
- 给 M7 加深度限制测试（修复后立即加）
- 给 reportIssue 状态前置校验加测试
- 给 schema NOT NULL 改动加 prisma migrate diff 验证

---

### 📌 给主 AI 的整合提示

1. **V2-B1（M7 死代码）必须修复才能整合**：极端场景栈溢出崩溃风险
2. **V2-S6（schema drift）建议 W3 末修完**：迁移成本最低，越拖越难
3. **V2-S7（FK 缺失）可推到 W4**：W3 阶段 reviewed_by_id 数据量小，影响不大
4. **V2-S8（BullMQ keyPrefix）推到首次部署前**：现在改一行配置，部署后改要清 Redis 数据
5. **整合时跑 `pnpm --filter @meimart/api test` 应该 173 测试全过**；修复 V2-B1 后需要新增至少 1 个深度限制测试
6. **e2e 测试用 testcontainers 起真实 PostGIS + Redis** 是 W4 阻断项（manifest §6 已标）

---

### 📊 与第一轮的对照总结

| 维度 | 第一轮发现 | 第二轮验证 |
|------|-----------|-----------|
| 🔴 阻塞项 | B1 + B2 | 全修，但 M7 引入新阻塞 V2-B1 |
| 🟡 建议项 | S1-S6 共 6 项 | 5 项正确，1 项不彻底（S6 → V2-S3） |
| 💭 小改进 | M1-M7 共 7 项 | 5 项正确，M2 引入新风险，M6 无效，M7 死代码 |
| 漏网之鱼 | — | 4 项：S5 事务不彻底 / reportIssue 状态校验 / schema drift / reviewed_by FK |
| 测试覆盖 | 31 单测 | 65 单测 + 1 集成（+34 单测 + 1 e2e） |
| 评分 | 7.2/10 | 7.7/10（+0.5） |

**整体评价**：第一轮报告的"修复优先级"清晰且可执行，开发者完整 follow-through，工作流是好的。第二轮发现的问题**严重程度低于第一轮**（无新业务回归 bug），但 V2-B1 必须在整合前修复。

---

**审查员签字**：代码审查员（GLM-5.2[1M]，Claude Code harness）
**报告版本**：v2.0
**主 AI 整合时**：按"修复优先级"逐项推进，V2-B1 + V2-S1 + V2-S6 阻断整合启动
