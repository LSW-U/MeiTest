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
