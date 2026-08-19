/**
 * Feedback 模块类型定义（P22 F1，2026-08-19）
 *
 * 类型对齐：
 *   - contract zod enum（小写字面量 FeedbackCategory，与前端 FEEDBACK_TYPE_KEYS 尾段一致）
 *   - Prisma category 是 String（非 enum，加枚举值无需 migration），service 层校验值域
 */

/**
 * 反馈类型枚举值（与 contract FeedbackCategory 同步）
 * 前端 FEEDBACK_TYPE_KEYS 存完整 i18n key（service.feedback.types.feature 等），
 * 提交前 .split('.').pop() 取尾段转纯枚举值。
 */
export const FEEDBACK_CATEGORIES = [
  'feature',
  'product',
  'order',
  'payment',
  'shipping',
  'other',
] as const;
export type FeedbackCategoryValue = (typeof FEEDBACK_CATEGORIES)[number];
