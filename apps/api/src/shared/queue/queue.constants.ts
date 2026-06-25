/**
 * BullMQ 队列名常量（三流程统一注册在此）
 *
 * 命名规范：业务域小写 + Queue 后缀（避免与其他 string token 撞）
 * 流程归属：
 *   - SETTLE_QUEUE：流程 M（settle T+1 结算 + 日终汇总）
 *   - 其他流程（C 的 order-timeout 等）按 W2-COLLABORATION.md §3 文件归属规则
 *     在本文件追加（共享基建文件，三流程都可加常量，不撞名即可）
 */
export const SETTLE_QUEUE = 'settle';
