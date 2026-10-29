/**
 * BullMQ 队列名常量（三流程统一注册在此）
 *
 * 命名规范：业务域小写（避免与其他 string token 撞）
 * 流程归属：
 *   - ORDER_TIMEOUT：流程 C（订单超时取消，PENDING_* 15min 自动 CANCELLED）
 *   - SETTLE：流程 M（settle T+1 结算 + 日终汇总）
 */
export const ORDER_TIMEOUT_QUEUE = 'order-timeout';
export const SETTLE_QUEUE = 'settle';
/**
 * 优惠券过期扫描队列（P1 领券体系，2026-07-31）
 * 每 5min 扫 UNUSED + promotion.endAt<now 的 UserCoupon -> EXPIRED
 */
export const COUPON_EXPIRE_QUEUE = 'coupon-expire';
/**
 * 通知推送队列（批A A5，2026-09-09）
 * admin 批量通知 → 按 100 人分块入队 → processor 逐块写 Notification + PUSH
 */
export const NOTIFICATION_QUEUE = 'notification';
/**
 * 孤儿图片清理队列（upload 模块批C U4/U4P，2026-09-10）
 * 每日一次扫描 MinIO 全量 key vs DB 引用集合（13 字段），仅删「无引用且超宽限期 7 天」对象
 */
export const ORPHAN_CLEANUP_QUEUE = 'orphan-cleanup';
/**
 * 触达自动化队列（客户画像批4，2026-10-18）
 * 每 30min 扫描六流（C1 挽留/C2 首购/C3 感谢/C6 生日/B2 补货/B3 购物车召回）
 */
export const ENGAGEMENT_QUEUE = 'engagement';
/**
 * 协同过滤重算队列（客户画像批6，2026-10-18）
 * 每 6 小时全量重算相似用户推荐 → 物化 similar_user_picks（A9/B7 读路径数据源）
 */
export const COLLABORATIVE_QUEUE = 'collaborative';
/**
 * 替换建议超时扫描队列（替换品批1，2026-10-29 D7）
 * 每 5min 扫 PENDING 建议超时（oos.suggestion_timeout_hours 默认 24h）→ 自动 DECLINED + 退款链 + 推送
 */
export const SUGGESTION_TIMEOUT_QUEUE = 'suggestion-timeout';
/**
 * 工单超时升级扫描队列（替换品批3，2026-10-30 D18）
 * 每 5min 扫超时未达标工单（firstRespDue/resolveDue 已过且非 RESOLVED/CLOSED）
 * → escalated=true + WS 推 customer-service room + PUSH
 */
export const TICKET_TIMEOUT_QUEUE = 'ticket-timeout';
