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
};
