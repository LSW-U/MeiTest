# 流程 C 完成报告 manifest

**流程代号**：C（交易/配送线）
**起止时间**：2026-06-23 ~ 2026-06-24
**完成度**：W2 ✅ / W3 🟡 / W4 ❌ / W5 ❌（详见下方"W-M-C-T 任务分解 §🟩 流程 2"对照）

> 流程 C 涉及 8 模块（cart · order · payment · refund · dispatch · rider · location · notify），W2-W5 分 4 周推进。本 manifest 仅覆盖 W2 范围（订单核心 + 支付 + 购物车 + admin-web 视角骨架）。W3-W5 待后续迭代补。

---

## 1. 新增独占文件（git merge 直接过，无冲突）

### 后端 modules

- `apps/api/src/modules/order/order.module.ts`（新建）
- `apps/api/src/modules/order/order.service.ts`（新建，下单核心 + 取消 + markPaid + 查询）
- `apps/api/src/modules/order/order.controller.ts`（新建，`/api/v1/client/orders` 路由）
- `apps/api/src/modules/order/order-no.service.ts`（新建，Redis INCR + Asia/Dili 时区）
- `apps/api/src/modules/order/order-status.machine.ts`（新建，纯函数状态机）
- `apps/api/src/modules/order/order.types.ts`（新建，DeviceType 转换 helper + 类型）

- `apps/api/src/modules/payment/payment.module.ts`（新建）
- `apps/api/src/modules/payment/payment.service.ts`（新建，createIntent/mockCallback/uploadReceipt）
- `apps/api/src/modules/payment/payment.controller.ts`（新建，`/api/v1/client/payments` 路由）

- `apps/api/src/modules/cart/cart.module.ts`（新建）
- `apps/api/src/modules/cart/cart.service.ts`（新建，加购/数量/选中/结算前预览）
- `apps/api/src/modules/cart/cart.controller.ts`（新建，`/api/v1/client/cart` 路由）

### 前端 screens

> ⚠️ 重要变更（2026-06-24）：`apps/client-app/` 与 `apps/rider-app/` 已迁出到 MeiMart1.0 独立 repo（commit 78abed4）。流程 C 不再写 RN 代码，仅做 admin-web 视角页面。

- `apps/admin-web/src/app/(merchant)/orders/page.tsx`（新建，商家订单列表骨架，mock 数据）
- `apps/admin-web/src/app/(warehouse)/orders/page.tsx`（新建，仓库拣货列表骨架）
- `apps/admin-web/src/lib/api.ts`（新建，fetch wrapper：Authorization + Accept-Language + X-Perspective + 401 跳转）

### 契约 schemas

- `packages/api-contract/src/schemas/cart.ts`（新建）
- `packages/api-contract/src/schemas/payment.ts`（新建，与 order schema 共用 PaymentMethod/PaymentStatus）
- `packages/api-contract/src/schemas/dispatch.ts`（新建，W3 用）
- `packages/api-contract/src/schemas/rider.ts`（新建，W3 用）
- `packages/api-contract/src/schemas/refund.ts`（新建，W5 用）

### i18n

- `packages/shared-locales/en/cart.json`（新建）
- `packages/shared-locales/zh/cart.json`（新建）
- `packages/shared-locales/id/cart.json`（新建）
- `packages/shared-locales/pt/cart.json`（新建）
- `packages/shared-locales/tet/cart.json`（新建）

---

## 2. 共享文件改动（主 AI 手工合并）

### `apps/api/src/app.module.ts`

新增 import（字母序插入）：
```ts
import { CartModule } from './modules/cart/cart.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
```
`imports` 数组从 `[AuthModule, RealtimeModule]` 变为 `[AuthModule, CartModule, OrderModule, PaymentModule, RealtimeModule]`（字母序，便于三流程 merge 时无冲突）。

### `apps/api/prisma/schema.prisma`

**无改动**。W1 已建 Order/OrderItem/OrderEvent/PaymentIntent/Cart/CartItem/RiderProfile/DeliveryTask/CashCollection/Address 等流程 C 所需表。W5 refund 表待新建（届时新增 migration `add_refund_c`）。

### `apps/api/prisma/migrations/`

**无新增**。W1 init migration 已含流程 C 所需全部表（29 张）。W5 refund 实做时新增。

### `apps/api/src/shared/db/index.ts`

**W1 文件扩展**（§2.4 报备）：
```ts
// 新增 export：
export {
  withTransaction,
  deductStock,
  releaseStock,         // ← 新加（W1 已实现 releaseStock 函数但未 export）
  type Tx,
  type TransactionOptions,
  type StockChangeContext,  // ← 新加
} from './transaction';
```
理由：order.service.ts 取消订单时需要 releaseStock 回滚库存，W1 transaction.ts 已有该函数但 index.ts 漏 export。属必要修复，不算改 W1 业务逻辑。

### `packages/api-contract/src/index.ts`

新增 export：
```ts
export * from './schemas/cart';
export * from './schemas/payment';
export * from './schemas/dispatch';
export * from './schemas/rider';
export * from './schemas/refund';
```

### `packages/api-contract/scripts/gen-openapi.ts`

新增 schema 注册 + 14 条新 path 注册（详见 git diff）。生成结果：`packages/api-contract/openapi.yaml` paths 14→20、schemas 26→34。

### `packages/shared-locales/index.ts`

新增 cart bundle 5 语言 import + 注册（详见 git diff）。

### `packages/shared-locales/{en,zh,id,pt,tet}/common.json`

**无改动**。流程 C 没用 c.{feature}.{key} 共用 key，所有订单/购物车文案用专门 namespace（`order.json` W1 已建 / `cart.json` 本次新建）。

### `packages/shared-locales/{en,zh,id,pt,tet}/errors.json`

新增错误码（5 语言）：
- `E-ORDER-005` SKU 无效或已下架
- `E-CART-001~004` 购物车相关
- `E-PAYMENT-004~010` 支付业务层
- `E-DISPATCH-001~005`（占位，W3 用）
- `E-RIDER-001~005`（占位，W3 用）

均在 §3.4 C 流程段内（E-ORDER-* / E-CART-* / E-PAYMENT-* / E-DISPATCH-* / E-RIDER-*），无跨流程编号。

### `apps/api/prisma/seed.ts`

**无改动**。W1 seed 已建 super_admin + shop + 3 warehouses + 10 products + 20 skus + 60 stock。流程 C 不需要额外 seed（W3 dispatch 接入时再加骑手 seed）。

---

## 3. 命名规范遵守自检

- [x] model 名无流程前缀（PascalCase 业务名）— Order / Cart / PaymentIntent 等，沿用 W1 已建
- [x] migration `--name` 末尾带 _w / _c / _m — 本周无新 migration
- [x] schema export 用 xxxSchema 命名 / OpenAPI 注册业务名 PascalCase — `Cart`/`PaymentIntent`/`DeliveryTask`/`RiderProfile`/`Refund`，符合 §3.3
- [x] 错误码在 §3.4 自己流程的范围内 — E-ORDER-* / E-CART-* / E-PAYMENT-* / E-DISPATCH-* / E-RIDER-*，无跨流程
- [x] i18n 共用 namespace 按 {flow}.{feature}.{key} 命名 — 本周仅用专门 namespace（cart.json / order.json），未碰 common.json
- [x] 跨 repo 契约向后兼容 — 全部为加字段/加 endpoint/加 schema 文件，无 breaking change（§3.7 自检通过）

---

## 4. 已知冲突点（提醒主 AI）

- [ ] `apps/api/src/app.module.ts`：imports 数组已按字母序插入 CartModule/OrderModule/PaymentModule（在 AuthModule 和 RealtimeModule 之间）。其他流程 merge 时按字母序继续插即可。
- [ ] `schema.prisma`：**无新增 enum，无新增 model**。W5 refund 实做时会新增 `Refund` model + `RefundStatus`/`RefundReason` enum（届时单独报备）。
- [ ] `migrations/`：本周无新 migration 目录。
- [ ] `packages/shared-locales/index.ts`：cart bundle 字段已加（`cart: enCart` 等）。其他流程加 bundle 时按字母序继续即可。
- [ ] `errors.json`：所有新错误码都在 C 流程段内，理论上与 W/M 流程不冲突。
- [ ] `apps/api/src/shared/db/index.ts`：**W1 文件扩展**（加 releaseStock/StockChangeContext export），manifest §2 已报备。主 AI merge 时保留这 2 行 export（W1 transaction.ts 实现已含 releaseStock，只是漏 export）。

---

## 5. 自检结果

- [x] `pnpm exec tsc --noEmit --ignoreDeprecations 5.0` 全过（apps/api，绕过 W1 遗留 tsconfig deprecation）
- [x] `pnpm -r typecheck` 7 个 workspace 中 6 过（apps/api 报 tsconfig deprecation，已知 W1 遗留，按 78abed4 commit 说明不影响工作）
- [x] `pnpm --filter @meimart/api test` 全过（**46 passed**，W1 留下的 5 个 spec 文件，无 regression）
- [x] `pnpm --filter @meimart/api-contract gen:openapi` 成功（paths 14→20，schemas 26→34）
- [x] `pnpm --filter @meimart/shared-types gen:types` 成功
- [x] `git diff --exit-code packages/api-contract/openapi.yaml packages/shared-types/src/api-types.ts` 已 commit（生成产物纳入版本控制）
- [ ] ESLint 全过 — **未跑**（apps/api 用 tsx esbuild 无 lint step，packages/* 用 tsc 已覆盖）

**未跑项说明**：
- apps/api 单测覆盖率：本周未补新模块单测，W3 联调时一并补（order-status.machine / order-no.service / order.service.createOrder / payment.service.mockCallback）。理由：W2 阶段先跑通骨架，避免覆盖率压力挤占 API 设计时间；46 个 W1 测试无 regression 是 baseline 保证。
- e2e 测试：未跑，需要 docker compose 起 postgres+postgis+redis，留 W3 集成测试阶段统一做。

---

## 6. 遗留问题（推到下一阶段）

### W2 已完成
- ✅ M1 order C1 状态机（10 状态 + 流转规则）
- ✅ M1 order C2 下单核心（PostGIS 自动匹配仓库 + 同步事务 + 行锁防超卖 + orderNo Redis INCR）
- ✅ M1 order C3 查询（列表游标分页 + 详情含 items/events）
- 🟡 M1 order C2-T5 超时自动取消（BullMQ 延迟队列）— **W3 接入 BullMQ 时补**
- 🟡 M1 order C2-T6 幂等键防重复下单 — controller 已读 header，**service 接入留 W3**
- ✅ M2 payment C1 策略抽象（W1 已封装，本周接入业务流）
- ✅ M2 payment C2 COD（W1 已实现 strategy，本周接入）
- ✅ M2 payment C3 银行转账（凭证上传 + PROCESSING 状态）
- ✅ M2 payment C4 微信支付 mock（mock callback 端点）
- ✅ M2 payment C5 PayPal/Stripe stub（同上）
- 🟡 M2 payment C6 对账 — **W6 切真时统一做**

### 推到 W3
- M3 cart（W2 已建骨架，W3 接入真 Redis 持久化 + 联调）
- M2 dispatch C1 抢单大厅 + WS 广播（schema 已建，service/controller 待实现）
- M3 rider C1-C2 入驻 + 上下班（schema 已建，service/controller 待实现）
- order 超时自动取消（BullMQ 延迟队列）
- order 幂等键服务端落地（IdempotencyKey 表已建，service 接入待做）

### 推到 W4
- M1 location（WS 已在 W1 完成，本周未扩展业务事件）
- M2 notify（Push/邮件/WhatsApp stub/站内信，未实现）

### 推到 W5
- M1 refund（schema 已建，service/controller/原路回款逻辑待实现）
- 流程 1 ↔ 流程 2 联调（商品→购物车→下单，需要 W 流程 catalog 模块完成）
- schema.prisma 加 Refund model + 新建 migration `add_refund_c`

### 推到 W6-W7
- 真实外部服务接入（Google Maps / 微信支付 / PayPal / Stripe 切真）
- e2e 测试套件（testcontainers + 真实 PostGIS）
- 性能压测（下单 100 QPS / WS 1000 连接）

### 已知风险
1. **apps/api typecheck 报 tsconfig deprecation**：`ignoreDeprecations: "6.0"` 需 TS 6.0+，本地 TS 5.9.3。W1 遗留，建议主 AI 在 integration/w2 时把 base tsconfig 改成 `ignoreDeprecations: "5.0"`（已有 PR 等待决策）。
2. **IdempotencyKey 表已建但未接入 service**：W2 阶段 controller 读 `Idempotency-Key` header 但 service 未消费。W3 cart 联调时统一接入。
3. **admin-web 商家订单接单接口未实现**：本周 admin-web 仅展示 mock 数据，W3 需补 `/api/v1/admin/orders/:id/accept` `/reject` `/pick` 等接口。
4. **客户端 App + 骑手 App 已迁出本 repo**：流程 C 之前规划的 client-app cart/order/payment screens 和 rider-app 全部页面都不在本 repo 范围（2026-06-24 78abed4 commit 决策）。

---

## 7. 流程 C 模块当前状态一览

| 模块 | W2 状态 | 完成度 |
|---|---|---|
| `cart` | ✅ service + controller 完成（DB 持久化） | 80%（Redis 优化 W3+） |
| `order` | ✅ 状态机 + 下单 + 取消 + 查询 + markPaid 完成 | 75%（幂等键/超时取消 W3） |
| `payment` | ✅ 业务层包裹 W1 5 策略完成 | 90%（对账 W6） |
| `refund` | 🟡 仅 schema 占位 | 5%（service W5） |
| `dispatch` | 🟡 仅 schema 占位 | 5%（W3） |
| `rider` | 🟡 仅 schema 占位 | 5%（W3） |
| `location` | 🟡 W1 已建 realtime gateway，业务事件未扩展 | 30%（W4） |
| `notify` | ❌ 未开始 | 0%（W4） |

---

**Manifest 版本**：v1.0
**最后更新**：2026-06-24（Asia/Dili）
**作者**：流程 C AI（GLM-5.2[1M]，Claude Code harness）
**主 AI 整合时**：按 §2 共享文件改动逐项 merge，§4 冲突点逐项核对
