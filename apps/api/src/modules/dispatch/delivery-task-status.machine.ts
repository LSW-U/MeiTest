/**
 * 配送任务（DeliveryTask）状态机 — 批2 v2 D8（方案 20261012）
 *
 * 任务书要求线性主链：
 *   PENDING_ASSIGN → ASSIGNED → PICKED_UP → DELIVERING → DELIVERED
 *
 * ⚠️ 现网差异登记（20261012，冲突以现网为准——见任务书「冲突登记→上报」）：
 *   1. delivery 任务实际两步取货送达：PICKED_UP → DELIVERED 跳过 DELIVERING
 *      （dispatch.service.ts deliverTask 前置 `PICKED_UP | DELIVERING`；P14 ④ 决策 1A：
 *      仅 return 任务走 PICKED_UP → DELIVERING → DELIVERED 三步）。故机器额外放行
 *      PICKED_UP → DELIVERED 这一条「跳步边」。
 *   2. FAILED 为异常终态，现网可从 ASSIGNED / PICKED_UP / DELIVERING / DELIVERING 进入
 *      （reportIssue V2-S2 允许 ASSIGNED/PICKED_UP/DELIVERING；与任务书线性主链不含
 *      FAILED 边冲突，按现网放行）。
 *   3. 任务书描述 return 任务「不触碰 delivery 机推进」不准确：return 任务同样推进本
 *      机器（pickupTask → PICKED_UP，startDelivering → DELIVERING，deliverTask return
 *      分支 → DELIVERED），只是不触碰 **Order** 状态机。机器本身 taskType 无关。
 *
 * 设计对齐 order-status.machine.ts：纯函数、无 DB、终态不可流转、自环非法。
 * assertCanTransition（Order 机）与任务类型不兼容，不能直接复用——本文件是独立机器。
 */
export type DeliveryTaskStatusValue =
  | 'PENDING_ASSIGN'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'FAILED';

/** 状态机合法流转表：from → 允许的 to 列表（含上述差异登记的跳步边与 FAILED 边） */
const TRANSITIONS: Record<DeliveryTaskStatusValue, DeliveryTaskStatusValue[]> = {
  PENDING_ASSIGN: ['ASSIGNED'],
  ASSIGNED: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['DELIVERING', 'DELIVERED', 'FAILED'], // DELIVERED = delivery 任务跳步边（现网）
  DELIVERING: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
};

/** 终态（不可再流转） */
const TERMINAL_STATES: ReadonlySet<DeliveryTaskStatusValue> = new Set(['DELIVERED', 'FAILED']);

/** 判断状态流转是否合法（纯函数） */
export function canTransition(from: DeliveryTaskStatusValue, to: DeliveryTaskStatusValue): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 断言状态流转合法，非法时抛错（service 调用） */
export function assertCanTransition(from: DeliveryTaskStatusValue, to: DeliveryTaskStatusValue): void {
  if (!canTransition(from, to)) {
    throw new Error(`DELIVERY_TASK_STATUS_TRANSITION_INVALID: ${from} → ${to}`);
  }
}

/** 是否为终态 */
export function isTerminalDeliveryTaskStatus(status: DeliveryTaskStatusValue): boolean {
  return TERMINAL_STATES.has(status);
}

/** 状态机合法流转列表（导出供测试 + 前端展示用） */
export function listAllowedNextDeliveryTask(status: DeliveryTaskStatusValue): DeliveryTaskStatusValue[] {
  if (TERMINAL_STATES.has(status)) return [];
  return TRANSITIONS[status] ?? [];
}
