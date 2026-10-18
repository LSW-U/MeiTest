/**
 * Engagement Templates — 批4 六流触达模板 key 定义（2026-10-18）
 *
 * 流清单（方案v2 §三 批4）：
 *   C1 挽留（沉睡定向券 + 推送） / C2 首购转化（新人推送） / C3 复购感谢（感谢 + 评价邀请）
 *   C6 生日 / B2 补货提醒（手工订阅） / B3 购物车遗留召回
 *
 * 文案：五语言 JSON 模板（en/zh/id/pt/tet，tet 用 `[TET]+en` 占位），
 * key 落 packages/shared-locales/<lang>/notification.json（同 notification-events.templates.ts
 * 范式，过 check:usage 门禁；渲染走 NotificationEventService.renderTemplate）。
 */
export const ENGAGEMENT_EVENT_KEYS = [
  'retentionWinback',
  'firstPurchaseNudge',
  'repurchaseThanks',
  'birthdayGreeting',
  'replenishReminder',
  'cartRecall',
  // 批5（2026-10-18）：C4 自动补货 / C7 降价提醒 / C8 到货提醒 / B4 浏览未买 nudge
  'autoReplenishDue',
  'priceDropAlert',
  'restockAlert',
  'viewNudge',
] as const;

export type EngagementEventType = (typeof ENGAGEMENT_EVENT_KEYS)[number];

/** 流标识（OutreachTrigger.flow）→ 模板 key + Notification type 映射 */
export const ENGAGEMENT_FLOW_META: Record<
  string,
  { event: EngagementEventType; notificationType: 'PROMOTION' | 'SYSTEM'; label: string }
> = {
  C1: { event: 'retentionWinback', notificationType: 'PROMOTION', label: 'retention' },
  C2: { event: 'firstPurchaseNudge', notificationType: 'PROMOTION', label: 'first-purchase' },
  C3: { event: 'repurchaseThanks', notificationType: 'SYSTEM', label: 'repurchase-thanks' },
  C6: { event: 'birthdayGreeting', notificationType: 'PROMOTION', label: 'birthday' },
  B2: { event: 'replenishReminder', notificationType: 'SYSTEM', label: 'replenish' },
  B3: { event: 'cartRecall', notificationType: 'PROMOTION', label: 'cart-recall' },
  // 批5 四流
  C4: { event: 'autoReplenishDue', notificationType: 'SYSTEM', label: 'auto-replenish' },
  C7: { event: 'priceDropAlert', notificationType: 'PROMOTION', label: 'price-drop' },
  C8: { event: 'restockAlert', notificationType: 'SYSTEM', label: 'restock' },
  B4: { event: 'viewNudge', notificationType: 'PROMOTION', label: 'view-nudge' },
};

/** 流标识守卫 */
export function isEngagementFlow(flow: string): flow is keyof typeof ENGAGEMENT_FLOW_META {
  return flow in ENGAGEMENT_FLOW_META;
}
