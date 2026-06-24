/**
 * Order Status Machine — 纯函数单测
 *
 * 覆盖：
 *   - canTransition：所有合法流转 + 非法流转 + 自环
 *   - assertCanTransition：合法通过 + 非法抛错
 *   - getInitialState：5 种 PaymentMethod × 初始状态
 *   - isUserCancellable：用户可取消 vs 客服介入
 *   - isTerminalStatus：COMPLETED / CANCELLED
 *   - listAllowedNext：流转列表
 */
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertCanTransition,
  getInitialState,
  isUserCancellable,
  isTerminalStatus,
  listAllowedNext,
} from '../src/modules/order/order-status.machine';

describe('order-status.machine', () => {
  describe('canTransition', () => {
    it('PENDING_PAYMENT → CONFIRMED 合法', () => {
      expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    });

    it('PENDING_PAYMENT → CANCELLED 合法（超时 / 用户取消）', () => {
      expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true);
    });

    it('PENDING_CONFIRM → CONFIRMED 合法（COD/BANK 商家接单）', () => {
      expect(canTransition('PENDING_CONFIRM', 'CONFIRMED')).toBe(true);
    });

    it('CONFIRMED → PICKED 合法（仓库拣货）', () => {
      expect(canTransition('CONFIRMED', 'PICKED')).toBe(true);
    });

    it('PICKED → OUT_FOR_DELIVERY 合法（骑手取货出发）', () => {
      expect(canTransition('PICKED', 'OUT_FOR_DELIVERY')).toBe(true);
    });

    it('OUT_FOR_DELIVERY → DELIVERED 合法（预付送达）', () => {
      expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
    });

    it('OUT_FOR_DELIVERY → DELIVERED_PAID 合法（COD 收款成功）', () => {
      expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED_PAID')).toBe(true);
    });

    it('OUT_FOR_DELIVERY → DELIVERED_UNPAID 合法（COD 拒付）', () => {
      expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED_UNPAID')).toBe(true);
    });

    it('DELIVERED_PAID → COMPLETED 合法', () => {
      expect(canTransition('DELIVERED_PAID', 'COMPLETED')).toBe(true);
    });

    it('DELIVERED → COMPLETED 合法', () => {
      expect(canTransition('DELIVERED', 'COMPLETED')).toBe(true);
    });

    it('PENDING_PAYMENT → OUT_FOR_DELIVERY 非法（跨状态跳跃）', () => {
      expect(canTransition('PENDING_PAYMENT', 'OUT_FOR_DELIVERY')).toBe(false);
    });

    it('CONFIRMED → DELIVERED 非法（跳过 PICKED）', () => {
      expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    });

    it('自环非法（同 status）', () => {
      expect(canTransition('CONFIRMED', 'CONFIRMED')).toBe(false);
    });

    it('COMPLETED → 任意 非法（终态）', () => {
      expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
    });

    it('CANCELLED → 任意 非法（终态）', () => {
      expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
    });

    it('DELIVERED_UNPAID → CANCELLED 合法（拒付后退款取消）', () => {
      expect(canTransition('DELIVERED_UNPAID', 'CANCELLED')).toBe(true);
    });

    it('DELIVERED_UNPAID → COMPLETED 合法（人工关单）', () => {
      expect(canTransition('DELIVERED_UNPAID', 'COMPLETED')).toBe(true);
    });
  });

  describe('assertCanTransition', () => {
    it('合法时不抛错', () => {
      expect(() => assertCanTransition('PENDING_PAYMENT', 'CONFIRMED')).not.toThrow();
    });

    it('非法时抛 ORDER_STATUS_TRANSITION_INVALID', () => {
      expect(() => assertCanTransition('PENDING_PAYMENT', 'DELIVERED')).toThrow(
        /ORDER_STATUS_TRANSITION_INVALID/,
      );
    });

    it('终态时抛错', () => {
      expect(() => assertCanTransition('COMPLETED', 'CANCELLED')).toThrow(
        /ORDER_STATUS_TRANSITION_INVALID/,
      );
    });
  });

  describe('getInitialState', () => {
    it('COD → PENDING_CONFIRM（货到付款，不预付）', () => {
      expect(getInitialState('COD')).toBe('PENDING_CONFIRM');
    });

    it('BANK_TRANSFER → PENDING_CONFIRM（银行转账，凭证审核后才确认）', () => {
      expect(getInitialState('BANK_TRANSFER')).toBe('PENDING_CONFIRM');
    });

    it('WECHAT → PENDING_PAYMENT（预付）', () => {
      expect(getInitialState('WECHAT')).toBe('PENDING_PAYMENT');
    });

    it('PAYPAL → PENDING_PAYMENT（预付）', () => {
      expect(getInitialState('PAYPAL')).toBe('PENDING_PAYMENT');
    });

    it('STRIPE → PENDING_PAYMENT（预付）', () => {
      expect(getInitialState('STRIPE')).toBe('PENDING_PAYMENT');
    });
  });

  describe('isUserCancellable', () => {
    it('PENDING_PAYMENT 可取消', () => {
      expect(isUserCancellable('PENDING_PAYMENT')).toBe(true);
    });

    it('PENDING_CONFIRM 可取消', () => {
      expect(isUserCancellable('PENDING_CONFIRM')).toBe(true);
    });

    it('CONFIRMED 可取消（商家未拣货前）', () => {
      expect(isUserCancellable('CONFIRMED')).toBe(true);
    });

    it('PICKED 不可取消（骑手已出发，需客服介入）', () => {
      expect(isUserCancellable('PICKED')).toBe(false);
    });

    it('OUT_FOR_DELIVERY 不可取消', () => {
      expect(isUserCancellable('OUT_FOR_DELIVERY')).toBe(false);
    });

    it('COMPLETED 不可取消', () => {
      expect(isUserCancellable('COMPLETED')).toBe(false);
    });

    it('CANCELLED 不可取消（已终态）', () => {
      expect(isUserCancellable('CANCELLED')).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('COMPLETED 是终态', () => {
      expect(isTerminalStatus('COMPLETED')).toBe(true);
    });

    it('CANCELLED 是终态', () => {
      expect(isTerminalStatus('CANCELLED')).toBe(true);
    });

    it('PENDING_PAYMENT 不是终态', () => {
      expect(isTerminalStatus('PENDING_PAYMENT')).toBe(false);
    });
  });

  describe('listAllowedNext', () => {
    it('PENDING_PAYMENT 允许 CONFIRMED + CANCELLED', () => {
      expect(listAllowedNext('PENDING_PAYMENT').sort()).toEqual(['CANCELLED', 'CONFIRMED']);
    });

    it('COMPLETED 允许列表为空（终态）', () => {
      expect(listAllowedNext('COMPLETED')).toEqual([]);
    });

    it('CANCELLED 允许列表为空（终态）', () => {
      expect(listAllowedNext('CANCELLED')).toEqual([]);
    });

    it('OUT_FOR_DELIVERY 允许 DELIVERED/DELIVERED_PAID/DELIVERED_UNPAID', () => {
      expect(listAllowedNext('OUT_FOR_DELIVERY').sort()).toEqual([
        'DELIVERED',
        'DELIVERED_PAID',
        'DELIVERED_UNPAID',
      ]);
    });
  });
});
