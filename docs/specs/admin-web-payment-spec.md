# Payment Admin 透视 — Spec（批次 3）

> 来源：admin-web 功能补全执行清单 §四批次 3
> 范围：后端 admin payment 5 端点 + 前端 /payments 页面
> 关联代码：`apps/api/src/modules/payment/` · `apps/api/src/modules/order/order.service.ts:692`

---

## 一、用户故事

- **平台管理员（super_admin）** 需要一个 payment 后台，审核银行转账凭证（用户上传后 PaymentIntent 处于 PROCESSING），确认收款后触发订单状态机（PENDING_PAYMENT → CONFIRMED），让订单进入配送流程。
- **客服（customer_service）** 需要按 orderNo / method / status 查询支付记录，处理用户"我付了但订单没确认"的咨询。
- 当前痛点：payment 模块只有客户端端点（customer 视角），admin 完全零接入。银行转账订单卡在 PENDING_PAYMENT，只能靠开发手动改库。

---

## 二、功能边界（做什么 / 不做什么）

### 做

1. **列表** `GET /admin/payments` — 游标分页，filter：status / method / orderId / orderNo / mockFlag（join order 取 orderNo）
2. **详情** `GET /admin/payments/:id` — PaymentIntent + 关联 order（orderNo / userId / warehouseId）+ order.refunds 列表
3. **确认收款** `POST /admin/payments/:orderId/confirm-receipt` — admin 审核银行转账凭证 → PaymentIntent PAID + Order PENDING_PAYMENT→CONFIRMED（**同事务**）
4. **标记失败** `POST /admin/payments/:orderId/mark-failed` — 手动标 PaymentIntent FAILED + 写 OrderEvent(PAYMENT_FAILED)；**不自动取消订单**（admin 看到后手动走 admin-order cancel，避免误操作）
5. **对账汇总** `GET /admin/payments/reconciliation` — group by status + method（运营对账用）

### 不做

- ❌ 不接真实第三方支付网关（Stripe/PayPal 仍 mock，W7-W8 拿到主体再切）
- ❌ mark-failed 不自动取消订单（避免误操作；admin 手动 cancel）
- ❌ 不做 PaymentEventOutbox 最终一致表（MVP 用同步事务，注释 L275 提到的 outbox 留未来上量）
- ❌ confirm-receipt 第一期只支持 BANK_TRANSFER（其他 method 走 mock-callback 自动 PAID，不需 admin 干预）

---

## 三、关键约束

### 3.1 事务陷阱（P0）

`payment.service.ts:262-278` 注释已警告：`markPaidByAdmin` 标 PaymentIntent=PAID 后必须同事务触发 `orderService.markPaid`，否则留下 PaymentIntent=PAID / Order=PENDING_PAYMENT 不一致。

**陷阱实锤**：`orderService.markPaid`（order.service.ts:699）内部自开 `withTransaction`，外层再包 withTransaction 会嵌套事务。

**方案（本 spec 采纳）**：抽 tx 版本 + 副作用分离
- `paymentService.markPaidByAdminTx(tx, orderId, adminId)` — tx 版本（用 tx.paymentIntent）
- `orderService.markPaidTx(tx, orderId, eventCtx)` — 把 markPaid 事务内核心（L700-743）抽出
- `orderService.postMarkPaidEffects(orderId, eventCtx, orderForNotify)` — 事务后副作用（cancelTimeout / createTask / broadcast / notify，失败容忍）
- controller confirm-receipt 编排：
  ```ts
  await withTransaction(async (tx) => {
    await paymentService.markPaidByAdminTx(tx, orderId, adminId);
    await orderService.markPaidTx(tx, orderId, eventCtx);
  });
  await orderService.postMarkPaidEffects(orderId, eventCtx, orderForNotify);
  ```
- 原 `markPaid` 改成调 `markPaidTx`（withTransaction 包）+ `postMarkPaidEffects`，保持现有调用方（client confirm / mock-callback）行为不变

### 3.2 状态机

| 操作 | PaymentIntent | Order | 前置条件 |
|---|---|---|---|
| confirm-receipt | PROCESSING/PENDING → PAID | PENDING_PAYMENT → CONFIRMED | order.status === PENDING_PAYMENT |
| mark-failed | PROCESSING/PENDING → FAILED | 不变（仅写 OrderEvent） | intent.status ∈ {PENDING, PROCESSING} |
| 幂等 | PAID 重复 confirm 直接 return | paymentStatus=PAID 跳过 | — |

### 3.3 权限

- 写操作（confirm-receipt / mark-failed）：仅 SUPER_ADMIN
- 读操作（list / detail / reconciliation）：SUPER_ADMIN + CUSTOMER_SERVICE

### 3.4 错误码段（E-PAYMENT-001~099）

已有：E-PAYMENT-005（intent not found，service:283）
新增：
- E-PAYMENT-001 confirm-receipt 状态不允许（intent 已 PAID/FAILED/CANCELLED）
- E-PAYMENT-002 mark-failed 状态不允许（intent 已 PAID/CANCELLED）
- E-PAYMENT-003 payment not found（detail 列表 by id）
- E-PAYMENT-004 receipt 缺失（confirm-receipt 时 BANK_TRANSFER 但无 receiptUrl）

### 3.5 性能

- 列表游标分页（take limit+1 探测，同 admin-orders / admin-refunds 范式）
- PaymentIntent 有 `@@index([method, status])`，按 method+status 筛走索引
- orderNo 搜索走 join（where: { order: { orderNo: { contains, mode: insensitive } } }）

---

## 四、实现拆分

### 后端（本会话）
1. `order.service.ts` 抽 markPaidTx + postMarkPaidEffects + 改造 markPaid
2. `payment.service.ts` 加 markPaidByAdminTx + listAllIntents + getAdminDetail + markFailedByAdmin + getReconciliation
3. `admin-payment.controller.ts` 新建（5 端点）
4. `payment.module.ts` 注册 AdminPaymentController
5. contract `payment.ts` 加 schema（ListPaymentIntentsQuery / PaymentIntentAdminView / PaymentIntentListResponse / ConfirmReceiptInput / MarkFailedInput / ReconciliationResponse）
6. gen-openapi 注册 5 端点

### 前端（下一会话）
7. `use-payments.ts` hook
8. `payments/page.tsx`（列表 + 状态 Tabs + method 筛选 + 详情 Dialog + 确认收款 Dialog + 对账 Card）
9. sidebar + 5 语言 i18n

---

## 五、验证

- typecheck 10/10
- 后端单测 703+ 全过（现有 markPaid 测试不破）
- confirm-receipt 同事务性（手动 verify：两步任一失败整体回滚，无中间状态）

---

*spec 完。本会话做后端 1-6，前端 7-9 下一会话。*
