/**
 * notification — 通知类型辅助
 *
 * 通知 type（如 ORDER_UPDATE / PROMOTION / SYSTEM）→ i18n key 后缀（OrderUpdate / Promotion / System），
 * 对齐 common.admin.notifications.typeOrderUpdate / typePromotion / typeSystem。
 *
 * 抽离自 notifications/page.tsx 与 notification-bell.tsx，避免两处重复实现。
 */

/**
 * 通知类型值转 i18n key 后缀（下划线分隔 → 驼峰）。
 *
 * @example
 *   notifTypeSuffix('ORDER_UPDATE') // → 'OrderUpdate'
 *   notifTypeSuffix('SYSTEM')       // → 'System'
 */
export function notifTypeSuffix(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
