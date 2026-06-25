# 📋 代码审查报告 — W3 流程 M（IM 自建 WS + settle T+1 BullMQ）

**审查范围**：`w3-flow-m` 分支相对 `main` HEAD `895ad6c` 的全部改动
**审查时间**：2026-06-25
**审查员**：Claude Code（代码审查员角色）

---

## 总体印象

整体架构与文件分工执行得很扎实：契约先行、错误码分段、流程 M 独占边界清晰、测试覆盖 4 大场景（256 用例全过）。但**有 4 个真正的生产级 bug**藏在细节里，最严重的是 i18n 错误码与代码完全错位——用户提现失败会看到"结算单已存在"。同时 IM 自建 WS 缺少参与方鉴权，任何登录用户都能监听任意会话。

---

## 🏗️ 架构与结构

- ✅ `apps/api/src/shared/queue/` 共享 BullMQ 基建设计合理（forRoot 一次，registerQueue 各模块自理），C 流程接 ORDER_TIMEOUT_QUEUE 不撞名
- ✅ `settle.processor.ts` + `settle.scheduler.ts` 职责分离干净（WorkerHost vs repeatable job 注册）
- ✅ `SETTLE_ORDER_AGGREGATOR` DI token + `MockOrderAggregator`，C 完成后切真 useClass 一行改完
- ⚠️ `ImMessage` 在 `realtime.gateway.ts:49` (TS interface) 和 `packages/api-contract/src/schemas/im.ts:67` (Zod schema) **两份独立定义**，靠人肉同步
- ⚠️ IM 会话模板字符串在 `im-signature.controller.ts:54-65` 和 `realtime.gateway.ts:265-267` 注释里**硬编码两份**

---

## 🔴 阻塞项（必须修复）

### 1. i18n `settle.json` 错误码消息全部错位（5 语言都错）

实际代码使用的错误码（`grep` 已确认）：

| Code | 代码实际含义 | i18n en 描述 | 一致？ |
|---|---|---|---|
| `E-SETTLE-001` | 提现金额超过余额 (`withdraw.service.ts:38`) | "Settlement already exists for this period" | ❌ |
| `E-SETTLE-002` | 提现申请不存在 (`withdraw.service.ts:75,115,180`) | "Settlement not found" | ❌ |
| `E-SETTLE-003` | 提现状态流转非法 (`withdraw.service.ts:81,121`) | "Invalid settlement status transition" | ❌（措辞指向 settlement） |
| `E-SETTLE-004` | 结算单不存在 (`settlement.service.ts:169`) | "Insufficient available balance" | ❌ |
| `E-SETTLE-005` | 未使用 | "Withdrawal request not found" | - |

`packages/api-contract/src/schemas/settle.ts:163-173` 的 `SETTLE_ERROR_CODES` 注释是**对的**（提现 / 结算单各自正确），i18n 5 语言文件都照着另一份错版抄。用户在 admin-web 点"提现申请"超额时会看到"该周期结算单已存在"，完全误导。

**修复**：5 个 `packages/shared-locales/{lang}/settle.json` 的 `errors.*` 5 条文案要按 `settle.ts` 里的注释重写。

---

### 2. `getYesterday()` 时区 bug — 02:00 Asia/Dili 跑任务时 periodDate 错一天

`apps/api/src/modules/settle/settle.processor.ts:137-141` 和 `settlement.service.ts:176-180` 两处都是：

```ts
private getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);  // ← UTC 日期
}
```

**问题**：cron 是 Asia/Dili UTC+9 的 02:00。那一刻是 UTC 17:00（前一天）。`new Date()` 拿到当前 instant，`getDate()` 返回 **UTC 日**，于是：

- 业务预期：02:00 Asia/Dili 跑 2026-06-26 凌晨，periodDate 应是 **2026-06-25**
- 实际产出：UTC `getDate()-1` = 24，periodDate = **"2026-06-24"** ← 错一天

每天少结一天，第二天的 T+1 实际跑成 T+2。

**修复**：用 Asia/Dili 时区格式化（`Intl.DateTimeFormat` 或 `date-fns-tz`），不能 `toISOString().slice(0,10)`。

---

### 3. IM 会话参与方鉴权绕过 — 任意登录用户可监听任意会话

`apps/api/src/modules/realtime/realtime.gateway.ts:280-300` 的 `handleImJoin`：

```ts
if (!data?.conversationId?.startsWith('conv:')) {
  return { ok: false, error: '...' };
}
await client.join(data.conversationId);   // ← 没校验 user 是会话参与方
```

任何登录的 customer 发 `im:join { conversationId: 'conv:cm:victim_c:victim_shop' }` 就能监听他人会话；`im:send` 同样能向任意 `conv:*` room 广播。`extractOtherUserId` 用 `myUserId` 比对 parts[2]/[3] 来 incr unread，但**这是副作用不是权限校验**——`client.join` 已经先发生了。

测试 `realtime.gateway.im.test.ts` 只测了"未认证"和"非法 conversationId 前缀"，**没测这个攻击路径**。

**修复**：在 `handleImJoin` 和 `handleImSend` 进入业务前，根据 `conversationType` + 当前 `user.sub` 校验是参与方（customer_rider 还要校验 orderId 属于该 customer）。

---

### 4. 提现申请并发 TOCTOU — 余额校验与 create 非原子

`apps/api/src/modules/settle/withdraw.service.ts:31-52`：

```ts
const balance = await this.getAvailableBalance(...);   // ← 读
if (input.amount > balance) throw ...;
const row = await db.withdrawalRequest.create({ ... }); // ← 写
```

两次并发 `create` 都读到 `balance=5000`、各申请 4000 → 都通过校验、都创建 → 余额 -3000。MVP 单 admin 触发概率低，但客户/商家自助申请场景必然踩雷。

**修复**：包在事务里 + settlement 行 `SELECT ... FOR UPDATE`；或在 `withdrawalRequest` 加 generated column / 触发器约束；最低成本是 `transaction(async tx => { ... })` 内重算 balance。

---

## 🟡 建议项（应该修复）

### 5. Settlement 状态机不完整 — 创建后永远是 PENDING

`settlement.service.ts:111` 创建时硬写 `status: 'PENDING'`，全仓库**没有任何接口把 PENDING → CONFIRMED**。但 `withdraw.service.ts:197` 的 `getAvailableBalance` 只认 `status: { in: ['CONFIRMED', 'PAID'] }`。结果是：settlement 创建出来永远不计入可用余额，提现永远 0 余额。

**修复**：要么在 `SettlementController` 加 `POST /:id/confirm` 接口；要么把 settlement 视作"创建即确认"，把 PENDING 也纳入 balance 计算。

---

### 6. `resolveWsUrl` 在 TLS-terminating 反代后返回 `ws://`

`im-signature.controller.ts:79-89` 用 `req.protocol === 'https'` 推断。Node 默认不信任 `X-Forwarded-Proto`，生产 nginx 终止 TLS 后 `req.protocol === 'http'`，客户端拿到 `ws://api.example.com` 而页面是 `https://` → 浏览器 mixed-content 拒绝。

**修复**：`main.ts` 加 `app.set('trust proxy', 1)`，或 prod 强制要求设 `WS_URL` 环境变量并在启动时校验。

---

### 7. `runSettlement` 幂等检查有 race（多实例部署时）

`settlement.service.ts:77-113` 的 `findFirst` + `create` 非原子。单 BullMQ worker concurrency=1 内部安全，但生产多实例时两 worker 同时拿不同 job 跑同 (periodDate, subjectType, subjectId) 会双写。前提是 `Settlement` 表上确实有 `@unique([periodDate, subjectType, subjectId])` 约束（schema 没附在本次 diff 里看不到）；如果没有约束，重复 settlement 会被静默写入。

**建议**：确认 schema 唯一约束存在；catch `P2002` 错误码降级为"已存在"返回。

---

### 8. BullMQ `repeat` + `jobId` 同传可能行为异常

`settle.scheduler.ts:35-44`：

```ts
await this.queue.add(SETTLE_JOB_RUN, {}, {
  repeat: { pattern: SETTLE_CRON_PATTERN, tz: SETTLE_CRON_TZ, key: SETTLE_REPEAT_KEY },
  jobId: SETTLE_REPEAT_KEY,  // ← BullMQ 文档：repeat 时不能指定 jobId
  ...
});
```

BullMQ 官方文档明确写 "When using repeat opts, you cannot specify a jobId"。repeat job 的去重靠 `repeat.key`，加 `jobId` 要么被忽略要么干扰调度。本地 dev 可能跑通但 prod 升级 BullMQ 时可能炸。

**修复**：删掉 `jobId: SETTLE_REPEAT_KEY` 这一行，只留 `repeat.key`。

---

### 9. `role: user.role as 'customer' | ...` 类型断言跳过运行时校验

`im-signature.controller.ts:50` 用 `as` 强转。`@Roles('customer','rider','super_admin','customer_service')` 路由保护下走不到这条路径，但万一 Guard 配置被改（如未来加新角色忘改这里）会静默放行未校验值。

**修复**：用 type guard 函数 `assertImRole(role): asserts role is ImRole`，或在 schema 校验层做。

---

### 10. `removeOnComplete/Fail` 在 scheduler 与 module default 不一致

- `settle.module.ts:33-34`: `removeOnComplete: 100, removeOnFail: 500`
- `settle.scheduler.ts:41-42`: `removeOnComplete: 100, removeOnFail: 200`

job-level 覆盖了 module default。fail 队列上限不一致，运营查问题时容易踩坑。

**修复**：scheduler 里别重写，让 module default 生效；或两处对齐。

---

### 11. IM 错误码文档与网关实际 emit 的 error message 不一致

`packages/api-contract/src/schemas/im.ts:83-85` 写 `E-IM-001/002/003`，但 `realtime.gateway.ts` 实际返回的是字符串错误信息（`'invalid conversationId'`、`'content required'` 等），**从未真的 emit `E-IM-*` 错误码**。客户端拿不到结构化错误码做 i18n。

**修复**：要么 gateway 改成抛 `WsException({ code: 'E-IM-001', ... })`；要么删掉契约里的 `E-IM-*` 别误导前端。

---

## 💭 小改进（锦上添花）

- **`getYesterday()` 重复定义两处**（`settle.processor.ts:137` + `settlement.service.ts:176`）→ 抽到 `shared/datetime/`
- **`messageRetentionDays: 7` 在 controller 硬编码**（`im-signature.controller.ts:28`）→ 共享常量与 gateway 对齐
- **会话模板 `'conv:cm:{customerId}:{shopId}'` 等字符串两处硬编码**（controller + gateway 注释）→ 抽到 `packages/api-contract/src/schemas/im.ts` 常量
- **`expire` 每条 im:send 都刷新**（`realtime.gateway.ts:362,369`）→ 首次设置即可，省一次 Redis 往返
- **`settle.processor.ts:68-85` 分支表达可读性**：subjectType+subjectId 的 3 种组合用早 return 更清楚
- **`im-signature.controller.test.ts`** 未覆盖"`warehouse_staff` 拒绝"（虽然路由 Roles 限制，但加一条断言更稳）
- **`realtime.gateway.im.test.ts`** 应加 "eavesdropping customer 1 不能 join conv:cm:customer2:shop1" 用例（呼应阻塞项 3）
- **MockOrderAggregator 用 `subjectId.charCodeAt(0)` 做 seed** → 当 `subjectId` 是 uuid 时分布不均，可换简单 hash

---

## ✅ 做得好的地方

1. **流程边界纪律**：M 流程独占文件全部新建，未碰 W/C 独占；共享基建 `shared/queue/` 设计开放
2. **DI token + Mock 模式**：`SETTLE_ORDER_AGGREGATOR` 切真只改一行 `useClass`
3. **BullMQ 配置基本正确**：`maxRetriesPerRequest: null`（BullMQ 强制要求）、指数退避、3 次重试、concurrency=1
4. **共享 keyPrefix 与 cache 模块一致**（都从 `REDIS_KEY_PREFIX` 读）
5. **baseline 修复正确**：`tsconfig.ignoreDeprecations: "6.0"`（TS 6.0.3 要求）+ `msgpackr-extract: false`（pnpm 11 要求）
6. **测试覆盖广度**：4 spec / 33 用例，覆盖幂等 / 状态机 / netAmount 公式 / conversation 解析 / WS URL 推断
7. **契约先行的纪律**：`im.ts` schema + openapi + i18n 同步落地
8. **错误码分段遵守 W2-COLLABORATION.md §3.4**（流程 M 段 001-099）

---

## 📊 评分

| 维度 | 评分 (1-10) | 说明 |
|------|------------|------|
| 正确性 | **5** | 阻塞项 1（i18n 错位）+ 2（时区错一天）+ 5（状态机死锁 PENDING）会让生产数据/UX 出错；阻塞项 3、4 是真实安全/资金风险 |
| 安全性 | **4** | IM 参与方鉴权缺失 + 提现 TOCTOU 是真漏洞；其他模块 RBAC + JWT 流程稳 |
| 可维护性 | **7** | 文件分工清晰、命名规范、注释充分；扣分在 ImMessage / 会话模板 / getYesterday 等多处重复定义 |
| 性能 | **8** | BullMQ 配置合理、concurrency=1 符合日终任务、`Promise.all` 批量拉 subjects、`for` 内顺序写避免热点 |
| 测试覆盖 | **6** | 4 spec 覆盖广，但漏测 eavesdropping 攻击路径、并发提现、getYesterday 时区行为；settle i18n 错位说明测试也没断言错误码 |

**综合**：W3 流程 M 的架构方向和工程纪律都不错，但**有 4 个不能 ship 的 blocker** 需要在整合进 main 之前修——其中 i18n 错位和 IM 鉴权绕过优先级最高（用户可见 / 数据安全），时区 bug 和提现 TOCTOU 次之（影响资金结算正确性）。建议整合前先把这 4 条修掉，状态机不完整（#5）和契约 IM 错误码（#11）可在 W3 末补。

---

## 🔧 建议的修复 commit 拆分

```
[W3-M-review-fix-1] 修复 settle i18n 5 语言错误码与代码错位（E-SETTLE-001~005 全量重写）
[W3-M-review-fix-2] getYesterday 改用 Asia/Dili 时区格式化（processor + service 共用 util）
[W3-M-review-fix-3] IM handleImJoin/handleImSend 加参与方鉴权 + eavesdropping 测试
[W3-M-review-fix-4] withdraw create 改事务避免余额 TOCTOU
[W3-M-review-fix-5] BullMQ scheduler 删 jobId + 补 settlement confirm 接口（状态机闭环）
```
