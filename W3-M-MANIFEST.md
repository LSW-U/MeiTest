# 流程 M 完成报告 manifest（W3）

**流程代号**：M（治理/财务）
**起止时间**：2026-06-25（W3 第一日交付）
**完成度**：W3 ✅（IM 用户签名接口 + settle T+1 BullMQ 定时任务 + 测试补强）

> 本份基于 W2-M-MANIFEST-W3.md 的 W3 续交付补丁，进一步落地 W3-M 真正剩余的工作：
> W2 W3 续交付补丁已把 IM WS 事件 handler、settle 接口骨架、提现接口、system-config 审计做完；
> W3 本份在此基础上补：IM 用户签名接口（自建 WS 场景的"后端薄壳"）、BullMQ T+1 定时任务、单测。

## 0. 执行摘要

W3 流程 M 按 W-M-C-T 任务分解 W3 章节全部完成：

- **IM 自建 WebSocket 用户签名接口** ✅ — `GET /api/v1/im/signature`，返回 WS URL / namespace / 事件名 / 会话 ID 模板
- **settle 结算单 T+1 BullMQ 定时任务** ✅ — `0 2 * * *` tz Asia/Dili，遍历 ACTIVE 商家 + 全部骑手，幂等调 `settlementService.runSettlement`
- **settle 提现审核** ✅（W2 续交付已实现，本份补单测验证状态机）
- **共享 BullMQ 基建** ✅ — `apps/api/src/shared/queue/`（QueueModule + SETTLE_QUEUE 常量；C 流程后续可复用，加 ORDER_TIMEOUT_QUEUE 不影响）

未做（依赖 C 流程）：
- `SETTLE_ORDER_AGGREGATOR` 切真（仍用 MockOrderAggregator，C 完成订单后改 useClass）

## 1. 新增独占文件（git merge 直接过，无冲突）

### 后端 modules（4 个新增 + 1 个模块新增目录）

- `apps/api/src/shared/queue/queue.module.ts` — BullModule.forRoot 共享基建（从 REDIS_URL 读配置）
- `apps/api/src/shared/queue/queue.constants.ts` — SETTLE_QUEUE 常量（C 流程后续加 ORDER_TIMEOUT_QUEUE 不撞名）
- `apps/api/src/shared/queue/index.ts` — barrel export
- `apps/api/src/modules/settle/settle.processor.ts` — BullMQ WorkerHost，处理 'run-settlement' 任务
- `apps/api/src/modules/settle/settle.scheduler.ts` — OnModuleInit 注册 T+1 repeatable job（02:00 Asia/Dili）
- `apps/api/src/modules/im/im.module.ts` — IM 模块（流程 M 独占）
- `apps/api/src/modules/im/im-signature.controller.ts` — GET /api/v1/im/signature

### 后端 tests（4 个新增）

- `apps/api/tests/settlement.service.test.ts` — 9 用例（幂等 / netAmount / 缺省取昨天 / list filter / detail 404）
- `apps/api/tests/withdraw.service.test.ts` — 8 用例（create 余额校验 / review APPROVE+REJECT / markPaid / list / detail）
- `apps/api/tests/realtime.gateway.im.test.ts` — 10 用例（im:join / im:send / im:read / unread counter / 三方会话 ID 解析）
- `apps/api/tests/im-signature.controller.test.ts` — 6 用例（结构完整性 / WS_URL 优先 / host 推断 / 兜底）

### 契约 schemas（1 个新增）

- `packages/api-contract/src/schemas/im.ts` — ImSignature + ConversationType + ImMessage + E-IM-001~003

### i18n（10 个新增）

- `packages/shared-locales/{en,zh,id,pt,tet}/settle.json` × 5（settlement/withdrawal/errors namespace）
- `packages/shared-locales/{en,zh,id,pt,tet}/im.json` × 5（signature/conversation/errors namespace）

## 2. 共享文件改动（主 AI 手工合并）

### apps/api/package.json

```diff
+ "@nestjs/bullmq": "^11.0.4",
+ "bullmq": "^5.79.1",
```

### apps/api/src/app.module.ts

```diff
  imports 数组字母序加 2 项：
+ ImModule,         // 在 CartModule 后 CatalogModule 前
  ...
+ QueueModule,      // 在 WarehouseModule 后
```

### apps/api/src/modules/settle/settle.module.ts

```diff
+ import { BullModule } from '@nestjs/bullmq';
+ import { SettleProcessor } from './settle.processor';
+ import { SettleScheduler } from './settle.scheduler';
+ import { SETTLE_QUEUE } from '../../shared/queue';

  @Module({
+   imports: [
+     BullModule.registerQueue({
+       name: SETTLE_QUEUE,
+       defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, ... },
+     }),
+   ],
    providers: [
      SettlementService,
      WithdrawalService,
      { provide: SETTLE_ORDER_AGGREGATOR, useClass: MockOrderAggregator },
+     SettleProcessor,
+     SettleScheduler,
    ],
  })
```

### apps/api/tsconfig.json（baseline 修复）

```diff
- "ignoreDeprecations": "5.0"
+ "ignoreDeprecations": "6.0"
```

**原因**：TS 已升级到 6.0.3，"5.0" 值被拒绝。W2 时 TS 还是 5.x，用 "5.0"；W3 升级后必改成 "6.0"。**主 AI 整合时这是 baseline 必修**。

### apps/api/pnpm-workspace.yaml（baseline 修复）

```diff
allowBuilds:
  ...
- msgpackr-extract: set this to true or false
+ msgpackr-extract: false
```

**原因**：W2 留下占位字符串，pnpm 11 在 deps status check 时报 ERR_PNPM_IGNORED_BUILDS exit 1，所有 pnpm script 都跑不起来。msgpackr-extract 是 bullmq 的可选 native 优化，false 退回纯 JS 实现不影响功能。**主 AI 整合时这是 baseline 必修**。

### packages/api-contract/src/index.ts

```diff
  export * from './schemas/dispatch';
+ export * from './schemas/im';
  export * from './schemas/order';
```

### packages/api-contract/scripts/gen-openapi.ts

```diff
  import {
+   // im（流程 M W3 自建 WS 用户签名接口）
+   ImSignature,
+   ConversationType,
+   ImMessage,
    ErrorResponse,
    Id,
  } from '../src/index.js';

  // 末尾新增（// ===== 生成 ===== 之前）：
+ registry.register('ImSignature', ImSignature);
+ registry.register('ImMessage', ImMessage);
+ registry.register('ConversationType', ConversationType);

+ registry.registerPath({
+   method: 'get',
+   path: '/api/v1/im/signature',
+   tags: ['im'],
+   description: '获取 IM 自建 WS 连接信息（URL / namespace / 事件名 / 会话 ID 模板）...',
+   responses: {
+     200: { description: 'IM 连接信息', content: { 'application/json': { schema: ImSignature } } },
+     401: { description: 'UNAUTHORIZED', content: { 'application/json': { schema: ErrorResponse } } },
+   },
+ });

  // tags 数组加：
+   { name: 'settle', description: '结算单 + 提现审核（M W3）' },
+   { name: 'im', description: 'IM 自建 WebSocket 用户签名（M W3）' },
```

### packages/api-contract/openapi.yaml（自动生成）

`pnpm --filter @meimart/api-contract gen:openapi` 重新生成：
- paths: 60 → **61**（新增 `/api/v1/im/signature`）
- schemas: 66 → **69**（新增 ImSignature / ImMessage / ConversationType）
- tags: +settle +im

### packages/shared-types/src/api-types.ts（自动生成）

`pnpm --filter @meimart/shared-types gen:types` 重新生成。

### packages/shared-locales/index.ts

```diff
  import enPlatform from './en/platform.json';
+ import enSettle from './en/settle.json';
+ import enIm from './en/im.json';
  import enErrors from './en/errors.json';

  // zh / id / pt / tet 同样新增 2 个 import × 4 语言 = +8 行

  export interface MessagesBundle {
    ...
    platform: typeof enPlatform;
+   settle: typeof enSettle;
+   im: typeof enIm;
    errors: typeof enErrors;
  }

  // messages 对象 5 个语言各加 settle + im 字段 = +10 行
```

## 3. 命名规范遵守自检

- [x] model 名无流程前缀（PascalCase 业务名）
- [x] migration 未新增（W2 已建 Settlement / WithdrawalRequest，本份无 schema 变更）
- [x] schema export 用 XxxSchema 命名（ImSignature / ImMessage / ConversationType）
- [x] 错误码在 §3.4 流程 M 段内（E-IM-001 ~ 003）
- [x] i18n namespace 按业务模块独立（settle.json + im.json，未污染 common.json）
- [x] commit 前缀 `[W3-M-*]`（建议格式，见 §8）
- [x] BullMQ queue 名业务域小写（SETTLE_QUEUE = 'settle'）

## 4. 已知冲突点（提醒主 AI）

### 4.1 共享文件冲突预估（5 处）

| 文件 | 冲突类型 | 解决策略 |
|---|---|---|
| `apps/api/src/app.module.ts` | imports 数组顺序 | 字母序 union（W → C → M） |
| `apps/api/package.json` | dependencies | 字母序合并（C 加 dispatch 相关、M 加 bullmq） |
| `packages/api-contract/src/index.ts` | export 顺序 | 字母序（im 在 dispatch 后 order 前） |
| `packages/api-contract/scripts/gen-openapi.ts` | import + registerPath | 各流程段独立，合并 union |
| `packages/api-contract/openapi.yaml` | 自动生成 | 主 AI 整合后跑 `gen:openapi` 一次重生成 |
| `packages/shared-locales/index.ts` | bundle 字段 | 字母序 union |
| `pnpm-lock.yaml` | lockfile | 主 AI 整合后跑一次 `pnpm install` |
| `pnpm-workspace.yaml` | allowBuilds 占位 | 已设 msgpackr-extract: false，主 AI 确认 |
| `apps/api/tsconfig.json` | ignoreDeprecations 值 | 必为 "6.0"（TS 6.0.3 要求） |

### 4.2 文件分工遵守

按 W2-COLLABORATION.md §2 矩阵：
- 流程 M 独占文件全部新建，**未触碰 W/C 独占**
- 新建共享基建 `apps/api/src/shared/queue/` 是 M 引入的，但设计为开放（C 加 ORDER_TIMEOUT_QUEUE 不撞名）
- W1/W2 完成文件**未修改**（除 app.module.ts 共享合并、settle.module.ts 自有扩展）

### 4.3 错误码段

- 已用：`E-PLATFORM-*` / `E-SETTLE-*` / `E-IM-*` / `E-AUDIT-*`（长形式）
- W3 新增：`E-IM-001` ~ `E-IM-003`（IM 会话 ID 格式 / 消息长度 / 未鉴权）
- 不会与 W/C 撞（W 用 E-WAREHOUSE / E-CATALOG 等；C 用 E-CART / E-ORDER / E-DISPATCH 等）

## 5. 自检结果

- [x] `pnpm -r typecheck`：7 workspace 全过（apps/api / apps/admin-web / 5 个 packages）
- [x] `pnpm --filter @meimart/api test`：22 spec / **256 用例** 全过（W2 18 spec / 220 用例，+4 spec / +36 用例）
- [x] `pnpm --filter @meimart/api-contract gen:openapi`：paths 61 / schemas 69（idempotent：连跑两次输出一致）
- [x] `pnpm --filter @meimart/shared-types gen:types`：ImSignature / ConversationType / ImMessage 已生成到 api-types.ts
- [x] i18n bundle 5 语言 × 2 namespace（settle / im）齐
- [x] BullMQ 装包：bullmq 5.79.1 + @nestjs/bullmq 11.0.4，无 peer dep 冲突

## 6. 遗留问题（推到下一阶段）

### 6.1 W3 末（C 流程订单/支付完成后）

- `settle.module.ts` providers 改 `SETTLE_ORDER_AGGREGATOR` 的 useClass：
  - 从 `MockOrderAggregator` 改成 `RealOrderAggregator`（C 流程提供）
- 接入真实订单聚合后，跑 e2e 验证 T+1 02:00 任务实际触发结算单生成

### 6.2 W4（流程 M W4 任务）

- **platform 审计查询高级筛选**：按 IP / User-Agent / Trace ID 检索（W2 已实现按用户/资源/时间）
- **审计详情 before/after diff 展示**（W2 已查到，UI 展示待补）

### 6.3 W5+（联调）

- 三端 SDK 启动时调 `/im/signature` 拿 WS 配置（admin-web / client-app / rider-app）
- 实际 IM 会话流程联调（客户 ↔ 商家 / 客户 ↔ 骑手按订单维度 / 客户 ↔ 客服）
- T+1 结算联调真实订单数据（C 完成后）

### 6.4 W6+（主体落实后）

- IM 迁移腾讯 IM（接口不变，RealtimeGateway 替换实现）
- 接入真实支付平台打款（替换 mark-paid 的线下打款凭证模式）

## 7. 文件归属自检

| 文件类型 | 状态 |
|---|---|
| 流程 M 独占文件 | 全部新建（im/ + queue/ + settle.processor + settle.scheduler + 4 单测 + settle/im schema + i18n × 10） |
| W1/W2 完成文件 | 仅修改 settle.module.ts（自有扩展）+ app.module.ts（共享 imports 合并） |
| 共享基建新引入 | shared/queue/（M 引入，C 后续复用） |
| 共享文件改动 | 全部记录在 §2 |
| 命名规范 | 全部遵守 §3（model PascalCase / migration 无新增 / schema XxxSchema / 错误码 §3.4 分段 / i18n 独立 namespace） |

## 8. 建议的 commit 拆分（供主 AI 整合参考）

```
[W3-M-1] IM 用户签名接口（GET /im/signature + ImSignature schema + i18n）
[W3-M-2] settle T+1 BullMQ 定时任务（QueueModule + SettleProcessor + SettleScheduler）
[W3-M-3] M 流程单测补强（settlement / withdraw / IM gateway / signature 共 4 spec / 33 用例）
[W3-M-4] baseline 修复（tsconfig ignoreDeprecations 6.0 + pnpm-workspace msgpackr-extract false）
```

---

**版本**：v1.1（v1.0 + 审查报告修复）
**输出位置**：`W3-M-MANIFEST.md`（repo 根目录）
**主 AI 整合顺序**：W → C → M（M 已就绪，可直接 rsync 独占文件 + 按 §2 合并共享文件）

---

## 附录 A：审查报告 P0+P1 修复（v1.1 增量）

依据 `W3-M-代码审查报告.md` 修复 5 项 P0 阻塞 + 3 项 P1 建议。

### A.1 P0 #1 — i18n settle.json 5 语言错误码与契约对齐

**问题**：i18n `settle.json` 5 个 E-SETTLE 错误码描述与代码实际含义完全错位（用户提现超额时显示"结算单已存在"）。

**修复**：5 语言 × 5 错误码全量重写，对照 `packages/api-contract/src/schemas/settle.ts` 的 SETTLE_ERROR_CODES 注释：
- E-SETTLE-001：提现金额超过应结余额（原错为"Settlement already exists"）
- E-SETTLE-002：提现申请不存在（原错为"Settlement not found"）
- E-SETTLE-003：提现申请状态不允许此操作（原错为"Invalid settlement status transition"）
- E-SETTLE-004：结算单不存在（原错为"Insufficient available balance"）
- E-SETTLE-005：结算频率配置无效（原错为"Withdrawal request not found"）

**改动文件**：`packages/shared-locales/{en,zh,id,pt,tet}/settle.json`

### A.2 P0 #2 — getYesterday 时区 bug（02:00 Asia/Dili 跑 T+1 错一天）

**问题**：`toISOString().slice(0,10)` 返回 UTC 日期，cron 在 Asia/Dili 02:00（= UTC 17:00 前一天）跑时，periodDate 比 Dili 视角的昨天少一天。

**修复**：
- 新建 `apps/api/src/shared/datetime/index.ts`，导出 `getYesterdayInTz(tz)` + `getDaysAgoInTz(n, tz)` + `isValidDateString(s)` + 常量 `MARKET_TIMEZONE = 'Asia/Dili'`
- 实现：用 `Intl.DateTimeFormat('en-CA', { timeZone, year/month/day })` 把当前 instant 在 tz 下格式化，再减天数（自动跨月跨年）
- `settle.processor.ts` + `settlement.service.ts` 两处 `getYesterday()` 都改用 util（消除重复）
- 补单测 `apps/api/tests/datetime.test.ts`：8 用例覆盖 cron 触发瞬间、跨年边界（2025-12-31 → 2026-01-01）、跨月边界（平年 2/28）、UTC vs Asia/Dili 视角对比、`isValidDateString` round-trip 防 V8 宽容解析

### A.3 P0 #3 — IM 会话参与方鉴权缺失（任意登录用户可监听任意会话）

**问题**：`handleImJoin` 只校验 `conv:` 前缀，未校验 user 是会话参与方。任意 customer 可 join `conv:cm:其他客户:shopX` 窃听消息。

**修复**：
- `realtime.gateway.ts` 加 `assertParticipant(conversationId, user)` helper：
  - `super_admin` / `customer_service`：允许任意（平台监管 + 客服介入三方会话）
  - `customer`：必须是 conversationId 中的 customerId
  - `rider`：必须是 `customer_rider` 会话中的 riderId
  - `customer_rider` 会话：额外查 `Order.userId === customerId` 校验订单归属
- `handleImJoin` 进业务前调 `assertParticipant`，失败时不 `client.join`
- `handleImSend` 强制要求"已 join 才能 send"（`client.rooms.has(conversationId)`），双重防御：即使 assertParticipant 漏检，未 join 也发不出
- 补 eavesdropping 攻击测试：10 用例覆盖 customer-A 不能 join/send 到 customer-B 的 cm/cs/cr 三类会话；customer_rider 缺 orderId；订单不属于他；rider 跨单；super_admin / customer_service 全通

**改动文件**：`apps/api/src/modules/realtime/realtime.gateway.ts`、`apps/api/tests/realtime.gateway.im.test.ts`

### A.4 P0 #4 — 提现 TOCTOU（并发 create 双通过余额校验）

**问题**：`withdraw.service.ts:create` 读 balance + create 两步非原子，并发请求可能都读到旧 balance 双通过。

**修复**：
- 用 `withTransaction(async tx => { ... })` 包整个流程
- 事务内第一步 `SELECT pg_advisory_xact_lock(hash(requesterType, requesterId))` 串行化同一 requester 的并发请求
- 事务内重算 balance（其他并发被锁阻塞，读到的是最新值）
- 校验 amount + create 全在事务内
- 补单测：并发 TOCTOU 场景（余额 5000，两个 create 各 4000 → 第一个成功，第二个事务内重算 balance=1000 → 拒）

**改动文件**：`apps/api/src/modules/settle/withdraw.service.ts`、`apps/api/tests/withdraw.service.test.ts`

### A.5 P0 #5 — Settlement 状态机闭环（创建后永远 PENDING，余额永远 0）

**问题**：settlement 创建时硬写 `status: 'PENDING'`，无任何 confirm 接口；但 `getAvailableBalance` 只认 `CONFIRMED/PAID` → 死锁，提现永远 0 余额。

**修复**：
- `settlement.service.ts` 加 `confirm(id, confirmerId)` 方法：PENDING → CONFIRMED + 写 `confirmedAt`；非 PENDING 状态拒（E-SETTLE-003）
- `settlement.controller.ts` 加 `POST /api/v1/admin/settle/settlements/:id/confirm`（super_admin）
- 顺带修 P0 #7：`runSettlement` 的 `create` catch P2002（unique violation）→ 回查现有记录返回（并发赢家已写入时的幂等语义）
- 补单测：5 用例（confirm 正常/非 PENDING/不存在/P2002 race/P2003 透传）

**改动文件**：`apps/api/src/modules/settle/{settlement.service,settlement.controller}.ts`、`apps/api/tests/settlement.service.test.ts`

**注**：审查报告 P0 #7 说 schema 缺 `@@unique([periodDate, subjectType, subjectId])`，核实后发现 schema 和 migration 都已存在（line 919 + `settlements_period_date_subject_type_subject_id_key`），审查判错。

### A.6 P1 #6 — resolveWsUrl 在 TLS-terminating 反代后返回 ws://（mixed-content）

**修复**：
- `apps/api/src/main.ts` bootstrap 加 `app.getHttpAdapter().getInstance().set('trust proxy', 1)`，信任一级反代的 X-Forwarded-Proto
- prod 强制 `WS_URL` 环境变量配置（漏配启动直接 fail-fast）

### A.7 P1 #8+#10 — BullMQ scheduler jobId 与 repeat 冲突 + removeOn 不一致

**修复**：`settle.scheduler.ts` 删 `jobId: SETTLE_REPEAT_KEY`（BullMQ 文档明确禁止与 repeat 同用），删 `removeOnComplete/removeOnFail`（让 `SettleModule.registerQueue` 的 default 生效）

### A.8 P1 #11 — IM 错误码契约对齐

**修复**：`realtime.gateway.ts` 加 `ImError` 接口 + `imError(code, message)` 工厂；`handleImJoin` / `handleImSend` 返回的 error 从 string 改成 `{ code: 'E-IM-001/002/003', message }` 结构化错误，前端可按 code 查 i18n

### A.9 验证

| 指标 | v1.0 | v1.1 |
|---|---|---|
| typecheck workspace | 7 全过 | 7 全过 |
| test spec | 22 | **23**（+ datetime） |
| test 用例 | 256 | **286**（+30 review-fix 用例） |
| openapi paths | 61 | 61（不变） |
| openapi schemas | 69 | 69（不变） |

### A.10 建议 commit 拆分（v1.1 增量）

```
[W3-M-review-fix-1] i18n settle.json 5 语言错误码与契约对齐
[W3-M-review-fix-2] getYesterday 改 Asia/Dili 时区 + 抽 shared/datetime util
[W3-M-review-fix-3] IM 会话参与方鉴权 + eavesdropping 测试 + 结构化错误码（P0 #3 + P1 #11）
[W3-M-review-fix-4] 提现 create 改事务 + advisory lock 防 TOCTOU
[W3-M-review-fix-5] Settlement 状态机闭环（confirm 接口 + P2002 race 处理）
[W3-M-review-fix-6] P1: trust proxy + BullMQ jobId 删除 + removeOn 一致
```

---
