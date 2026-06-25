/**
 * BullMQ 队列名常量（三流程统一注册在此）
 *
 * 命名规范：业务域小写（避免与其他 string token 撞）
 * 流程归属：
 *   - ORDER_TIMEOUT：流程 C（订单超时取消，PENDING_* 15min 自动 CANCELLED）
 *   - SETTLE：流程 M 预留（settle T+1 结算 + 日终汇总，整合后用）
 */
export const ORDER_TIMEOUT_QUEUE = 'order-timeout';
export const SETTLE_QUEUE = 'settle';
