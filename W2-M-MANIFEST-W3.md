# 流程 M 完成报告 manifest（W3 续交付）

> **本份为 W2-M-MANIFEST.md 的 W3 续交付补丁**，记录 2026-06-24 决策落地后的工作。
> 原 W2-M-MANIFEST.md（W2 D1 交付）保留不动。

**流程代号**：M（治理/财务）
**起止时间**：2026-06-24（W3 续交付，基于 2026-06-24 决策）
**完成度**：W3 ✅（settle 接口骨架 + IM 自建 + 系统配置审计）/ W4 大部分 ✅（CSV 导出 / Redis cache 已在 W2 提前完成 / 配置变更审计本次补）

## 0. 2026-06-24 决策落地

| 决策 | 选择 | 本次实现 |
|---|---|---|
| **IM SDK 选型** | 自建 WebSocket（不接腾讯 IM/融云） | ✅ 扩展 RealtimeGateway 加 im:join / im:send / im:message / im:read 事件 |
| **M W3 节奏 B** | settle 接口框架先行（mock 订单数据） | ✅ settlement + withdraw 模块完整骨架 |
| **M W3 节奏 C** | W4 不依赖 C 的任务先做 | ✅ 系统配置变更审计（CSV / Redis cache 已提前在 W2） |
| **结算频率** | T+1，接口预留配置项 | ✅ SettlementService.runSettlement 支持 periodDate 参数 |

## 1. 新增独占文件（git merge 直接过）

### 后端 modules

- `apps/api/src/modules/settle/settle.module.ts` — 注册 Settlement/Withdrawal controller + service
- `apps/api/src/modules/settle/settlement.service.ts` — 结算单生成（T+1 幂等 + MockOrderAggregator）
- `apps/api/src/modules/settle/settlement.controller.ts` — GET 列表/详情 + POST 手动触发（super_admin）
- `apps/api/src/modules/settle/withdraw.service.ts` — 提现申请 + 审核 + 线下打款 + 可用余额计算
- `apps/api/src/modules/settle/withdraw.controller.ts` — POST 创建/review/mark-paid + GET 列表/详情

### 契约 schemas

- `packages/api-contract/src/schemas/settle.ts` — Settlement / WithdrawalRequest / PayoutAccount / 输入输出 + E-SETTLE-001~005 错误码

## 2. 共享文件改动（主 AI 手工合并）

### apps/api/src/app.module.ts

```ts
+ import { SettleModule } from './modules/settle/settle.module';

imports 数组新增（按字母序 PlatformModule → RealtimeModule → SettleModule）：
  imports: [AuthModule, PlatformModule, RealtimeModule, SettleModule]
```

### apps/api/src/modules/realtime/realtime.gateway.ts（已有文件，扩展）

新增 3 个 IM 事件 handler：
- `@SubscribeMessage('im:join')` — 加入会话 room
- `@SubscribeMessage('im:send')` — 发消息（广播 + Redis 暂存最近 100 条 + 未读数 +1）
- `@SubscribeMessage('im:read')` — 标记已读（清零未读数）

新增类型导出：
- `ConversationType`（'customer_merchant' | 'customer_rider' | 'customer_service'）
- `ImMessage`（消息结构）

新增 import：`redis` from `shared/cache`

### apps/api/src/modules/platform/system-config.service.ts（已有文件，扩展）

`update()` 方法新增可选参数 `auditCtx`：
```ts
auditCtx?: {
  deviceType?: 'CLIENT_APP' | 'RIDER_APP' | 'ADMIN_WEB';
  perspective?: string;
  ip?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
}
```

变更时写 AuditLog（action=UPDATE_SYSTEMCONFIG，含 before/after 快照）。

向后兼容：auditCtx 可选，老调用方不传也能工作。

### apps/api/tests/system-config.service.test.ts（已有文件，扩展）

mock db 加 `auditLog: { create: vi.fn().mockResolvedValue({}) }`。

### packages/api-contract/src/index.ts（已有文件，扩展）

```ts
+ export * from './schemas/settle';
```

### packages/api-contract/openapi.yaml（自动生成）

`pnpm --filter @meimart/api-contract gen:openapi` 重新生成：
- paths: 10 → 16（新增 6 个 settle 端点）
- schemas: 26 → 33（新增 7 个 settle 相关 schema）

### packages/shared-types/src/api-types.ts（自动生成）

主 AI 整合时跑 `pnpm --filter @meimart/shared-types gen:types` 重新生成。

## 3. 命名规范遵守自检

- [x] model 名无流程前缀（Settlement / WithdrawalRequest）
- [x] migration `--name` 末尾带 _m（W2 时已建 `add_platform_settle_m`）
- [x] schema export 用 XxxSchema 命名（SettlementSchema / WithdrawalRequestSchema）
- [x] 错误码在 §3.4 流程 M 范围内（E-SETTLE-001 ~ 005）
- [x] IM 事件无流程前缀（im:join / im:send，因为是跨流程共享基建）

## 4. 已知冲突点（提醒主 AI）

- **schema.prisma 未改**（W2 时已建 Settlement / WithdrawalRequest，本次无新 model）
- **migrations 未加新文件**（无 schema 变更）
- **realtime.gateway.ts** 是 W1 + 本次扩展的文件，merge 时注意：
  - W1 创建的 `location:update` / `join:order` / `leave:order` 不动
  - 本次新增 `im:join` / `im:leave` / `im:send` / `im:read` 在文件末尾
- **system-config.service.ts** `update()` 方法签名扩展（加可选参数 `auditCtx`），向后兼容
- **shared-locales/settle.json** 未创建（W3 settle 错误信息复用 errors.json + i18n 自动 fallback en）

## 5. 自检结果

- [x] `pnpm -r typecheck` 全过（含本次新增 settle 模块 + IM 扩展）
- [x] `pnpm -r test` 全过（60 tests，含 system-config 测试 mock 修复）
- [x] `pnpm --filter @meimart/api-contract gen:openapi` 后 paths 16 / schemas 33
- [ ] `pnpm --filter @meimart/shared-types gen:types`（主 AI 整合时跑）

## 6. 待 W3 末/后续工作

### W3 末（C 流程订单/支付完成后）
- settle.module.ts providers 改 `SETTLE_ORDER_AGGREGATOR` 的 useClass：
  - 从 `MockOrderAggregator` 改成 `RealOrderAggregator`（C 流程提供）
- 接入 BullMQ 定时任务跑 `settlementService.runSettlement`（T+1 02:00 Asia/Dili）
- 接入 BullMQ 定时任务汇总日终数据

### W6+（主体落实后）
- IM 迁移腾讯 IM（接口不变，RealtimeGateway 替换实现）
- 接入真实支付平台打款（替换 mark-paid 的线下打款凭证模式）

### W3 + W4 测试补强（M-3 测试覆盖率）
- settle 模块单测（settlement.service.test.ts / withdraw.service.test.ts）
- realtime.gateway IM 事件单测（im:send / im:read / 未读数）

## 7. 决策 2026-06-24 实现总结

✅ 决策 1 — IM 自建 WebSocket：
   扩展 RealtimeGateway 加 4 个 IM 事件 handler
   Redis 暂存最近 100 条消息 + 未读数计数
   三方会话支持（customer_merchant / customer_rider / customer_service）

✅ 决策 2 B — settle 接口框架先行：
   Settlement / WithdrawalRequest model（W2 已建）
   SettlementService + WithdrawalService 完整骨架
   MockOrderAggregator 接口抽象（C 完成后切 RealOrderAggregator）

✅ 决策 2 C — W4 不依赖 C 的任务先做：
   系统配置变更审计（本次）
   审计 CSV 导出（W2 已提前）
   Redis cache-aside（W2 已提前）

✅ 结算频率 T+1 + 配置项预留：
   SettlementService.runSettlement 接受 periodDate 参数
   默认 = 昨天（T+1），可传任意日期（周结/月结支持）
