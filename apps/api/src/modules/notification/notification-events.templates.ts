/**
 * Notification Event Templates — 七类事件模板 key 定义（批A A4，2026-09-09）
 *
 * 事件清单（方案v2 §3.4）：
 *   1. order-confirmed   订单已确认（支付成功）  → CUSTOMER, ORDER_UPDATE, data.orderId
 *   2. order-cancelled   订单取消              → CUSTOMER, ORDER_UPDATE, data.orderId+reason
 *   3. order-delivered   订单送达/签收          → CUSTOMER, ORDER_UPDATE, data.orderId
 *   4. task-assigned     新任务分配            → RIDER, RIDER_TASK, data.taskId+orderId
 *   5. task-failed       任务取消/失败          → RIDER, RIDER_TASK, data.taskId+orderId
 *   6. settlement-confirmed 结算入账           → RIDER, WALLET, data.amount+settlementId
 *   7. withdraw-reviewed 提现结果              → RIDER, WALLET, data.withdrawId+status
 *
 * 文案：五语言 JSON 硬编码模板（en/zh/tet/pt/id，tet 用 `[TET]+en` 占位），
 * key 同步落 packages/shared-locales/<lang>/notification.json（过 check:usage 门禁）。
 */
export const NOTIFICATION_EVENT_KEYS = [
  'orderConfirmed',
  'orderCancelled',
  'orderDelivered',
  'taskAssigned',
  'taskFailed',
  'settlementConfirmed',
  'withdrawReviewed',
  // 批4 触达自动化（2026-10-18）：C1/C2/C3/C6 + B2/B3 六事件
  'retentionWinback',
  'firstPurchaseNudge',
  'repurchaseThanks',
  'birthdayGreeting',
  'replenishReminder',
  'cartRecall',
  // 批5（2026-10-18）：C4 自动补货 / C7 降价 / C8 到货 / B4 浏览未买
  'autoReplenishDue',
  'priceDropAlert',
  'restockAlert',
  'viewNudge',
  // 缺货履约闭环批2（2026-10-24）：缺货登记推送（D8/D16，同步直推不进 BullMQ）
  'outOfStock',
  // 批2 审查 P3-3（20261024）：全缺 → 订单已 CANCELLED，「已取消-全部商品缺货」分支文案
  'outOfStockCancelled',
  // 缺货履约闭环批3（2026-10-24）：system 自动退款结果推送（D9b/D17，直退完成 / 超限转人工）
  'outOfStockAutoRefunded',
  'outOfStockRefundPending',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_KEYS)[number];

/** 事件模板表（key → shared-locales notification.json 的 key） */
export const EVENT_TEMPLATES: Record<NotificationEventType, { titleKey: string; contentKey: string }> = {
  orderConfirmed: { titleKey: 'orderConfirmed.title', contentKey: 'orderConfirmed.content' },
  orderCancelled: { titleKey: 'orderCancelled.title', contentKey: 'orderCancelled.content' },
  orderDelivered: { titleKey: 'orderDelivered.title', contentKey: 'orderDelivered.content' },
  taskAssigned: { titleKey: 'taskAssigned.title', contentKey: 'taskAssigned.content' },
  taskFailed: { titleKey: 'taskFailed.title', contentKey: 'taskFailed.content' },
  settlementConfirmed: { titleKey: 'settlementConfirmed.title', contentKey: 'settlementConfirmed.content' },
  withdrawReviewed: { titleKey: 'withdrawReviewed.title', contentKey: 'withdrawReviewed.content' },
  // 批4 触达自动化六事件
  retentionWinback: { titleKey: 'retentionWinback.title', contentKey: 'retentionWinback.content' },
  firstPurchaseNudge: { titleKey: 'firstPurchaseNudge.title', contentKey: 'firstPurchaseNudge.content' },
  repurchaseThanks: { titleKey: 'repurchaseThanks.title', contentKey: 'repurchaseThanks.content' },
  birthdayGreeting: { titleKey: 'birthdayGreeting.title', contentKey: 'birthdayGreeting.content' },
  replenishReminder: { titleKey: 'replenishReminder.title', contentKey: 'replenishReminder.content' },
  cartRecall: { titleKey: 'cartRecall.title', contentKey: 'cartRecall.content' },
  // 批5 四事件
  autoReplenishDue: { titleKey: 'autoReplenishDue.title', contentKey: 'autoReplenishDue.content' },
  priceDropAlert: { titleKey: 'priceDropAlert.title', contentKey: 'priceDropAlert.content' },
  restockAlert: { titleKey: 'restockAlert.title', contentKey: 'restockAlert.content' },
  viewNudge: { titleKey: 'viewNudge.title', contentKey: 'viewNudge.content' },
  // 缺货履约闭环批2：登记后通知顾客（受众 CUSTOMER、ORDER_UPDATE，data.orderId + 缺货项摘要）
  outOfStock: { titleKey: 'outOfStock.title', contentKey: 'outOfStock.content' },
  // 批2 审查 P3-3：全缺订单已取消分支（同受众；data.cancelled=true 时 notify 用此 key）
  outOfStockCancelled: { titleKey: 'outOfStockCancelled.title', contentKey: 'outOfStockCancelled.content' },
  // 缺货履约闭环批3：system 自动退款直退完成 / 超限转人工（同受众，data.orderId + amount）
  outOfStockAutoRefunded: { titleKey: 'outOfStockAutoRefunded.title', contentKey: 'outOfStockAutoRefunded.content' },
  outOfStockRefundPending: { titleKey: 'outOfStockRefundPending.title', contentKey: 'outOfStockRefundPending.content' },
};
