/**
 * 订单状态机（v0.3 决策：含 PENDING_PAYMENT / DELIVERED_PAID / DELIVERED_UNPAID）
 *
 * 状态流转图（与 schema.prisma OrderStatus enum + contract order.ts 注释同源）：
 *
 *   入口分叉（按 PaymentMethod）：
 *     COD / BANK_TRANSFER  → PENDING_CONFIRM（货到/转账，无需预付）
 *     WECHAT / PAYPAL / STRIPE → PENDING_PAYMENT（必须预付成功才进 CONFIRMED）
 *
 *   PENDING_PAYMENT → CONFIRMED（支付回调标 PAID 时触发）
 *                  → CANCELLED（超时 15min / 用户取消）
 *
 *   PENDING_CONFIRM → CONFIRMED（商家/admin 接单）
 *                  → CANCELLED（商家拒单 / 用户取消）
 *
 *   CONFIRMED → PICKED（仓库拣货完成）
 *   PICKED → OUT_FOR_DELIVERY（骑手取货出发）
 *
 *   OUT_FOR_DELIVERY:
 *     预付已付 → DELIVERED（骑手送达）
 *     COD      → DELIVERED_PAID（成功收款）/ DELIVERED_UNPAID（拒付，人工跟进）
 *
 *   DELIVERED / DELIVERED_PAID → COMPLETED（评价或自动定时）
 *   DELIVERED_UNPAID → COMPLETED（人工关单）/ CANCELLED（退款）
 *
 *   任意业务态 → CANCELLED（仅 PENDING_* / CONFIRMED 可用户取消；PICKED 后只能客服介入）
 *
 * 设计：
 *   - 纯函数（无 DB 调用），便于单测
 *   - 不允许跳跃（如 PENDING_CONFIRM → OUT_FOR_DELIVERY 直接跳非法）
 *   - 调用方负责落库 + 写 OrderEvent
 */
import type { OrderStatusValue, PaymentMethodValue } from './order.types';

/** 状态机合法流转表：from → 允许的 to 列表 */
const TRANSITIONS: Record<OrderStatusValue, OrderStatusValue[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  PENDING_CONFIRM: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PICKED', 'CANCELLED'],
  PICKED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERED_PAID', 'DELIVERED_UNPAID'],
  DELIVERED_PAID: ['COMPLETED'],
  DELIVERED_UNPAID: ['COMPLETED', 'CANCELLED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** 终态（不可再流转） */
const TERMINAL_STATES: ReadonlySet<OrderStatusValue> = new Set(['COMPLETED', 'CANCELLED']);

/**
 * 判断状态流转是否合法
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns true=合法 / false=非法
 */
export function canTransition(from: OrderStatusValue, to: OrderStatusValue): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 断言状态流转合法，非法时抛错（service 调用）
 *
 * @throws Error('ORDER_STATUS_TRANSITION_INVALID: ${from} → ${to}')
 */
export function assertCanTransition(from: OrderStatusValue, to: OrderStatusValue): void {
  if (!canTransition(from, to)) {
    throw new Error(`ORDER_STATUS_TRANSITION_INVALID: ${from} → ${to}`);
  }
}

/**
 * 根据 PaymentMethod 决定订单初始状态
 *
 * - COD / BANK_TRANSFER → PENDING_CONFIRM（不预付）
 * - WECHAT / PAYPAL / STRIPE → PENDING_PAYMENT（必须先预付）
 */
export function getInitialState(paymentMethod: PaymentMethodValue): OrderStatusValue {
  switch (paymentMethod) {
    case 'COD':
    case 'BANK_TRANSFER':
      return 'PENDING_CONFIRM';
    case 'WECHAT':
    case 'PAYPAL':
    case 'STRIPE':
      return 'PENDING_PAYMENT';
    default: {
      // 运行时兜底（typescript 编译时已穷尽，运行时若有非法值也不会沉默失败）
      const exhaustive: string = paymentMethod as string;
      throw new Error(`UNSUPPORTED_PAYMENT_METHOD: ${exhaustive}`);
    }
  }
}

/**
 * 判断当前状态是否允许用户取消
 *
 * 业务规则：PICKED 之后骑手已出发，用户不能自助取消（需客服介入）
 */
export function isUserCancellable(status: OrderStatusValue): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PENDING_CONFIRM' || status === 'CONFIRMED';
}

/** 是否为终态 */
export function isTerminalStatus(status: OrderStatusValue): boolean {
  return TERMINAL_STATES.has(status);
}

/**
 * 状态机合法流转列表（导出供测试 + 前端展示用）
 */
export function listAllowedNext(status: OrderStatusValue): OrderStatusValue[] {
  if (TERMINAL_STATES.has(status)) return [];
  return TRANSITIONS[status] ?? [];
}
