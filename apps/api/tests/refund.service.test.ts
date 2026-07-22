/**
 * Refund Service 单测（W7-fix P2 修复 — 退款审核金额断言）
 *
 * 覆盖：
 *   - createRefund 接单前 → 自动通过 COMPLETED + 调 OrderService.cancelOrderInternal
 *   - createRefund 接单后 → PENDING
 *   - createRefund 订单不存在 / 不归属 / 已 CANCELLED / 已有进行中退款
 *   - reviewRefund APPROVE 正常路径（金额一致）
 *   - reviewRefund APPROVE 金额 = 0 → E-ORDER-007（P2 新增）
 *   - reviewRefund APPROVE 金额 ≠ payable → E-ORDER-007（P2 新增）
 *   - reviewRefund APPROVE 订单不存在 → E-ORDER-004
 *   - reviewRefund REJECT 正常 + 无 reviewNote
 *   - reviewRefund 状态非 PENDING → E-ORDER-003
 *   - cancelRefund 正常 / 不归属 / 非 PENDING
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';

const { mockDb, mockLogger, mockModuleRef, mockOrderService } = vi.hoisted(() => ({
  mockDb: {
    order: {
      findUnique: vi.fn(),
    },
    refund: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockModuleRef: {
    get: vi.fn(),
  },
  mockOrderService: {
    cancelOrderInternal: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/logger/logger', () => ({ logger: mockLogger }));
vi.mock('../src/modules/order/order.service', () => ({
  OrderService: class {
    cancelOrderInternal = mockOrderService.cancelOrderInternal;
  },
}));

import { RefundService } from '../src/modules/refund/refund.service';

const baseOrder = {
  id: 'order-1',
  userId: 'user-1',
  status: 'CONFIRMED',
  payableAmount: 10000,
  items: [],
};

const baseRefund = {
  id: 'refund-1',
  orderId: 'order-1',
  userId: 'user-1',
  amount: 10000,
  reason: 'QUALITY_ISSUE',
  reasonDetail: 'item damaged',
  status: 'PENDING',
  transactionId: null,
  refundMethod: 'WECHAT',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  completedAt: null,
  createdAt: new Date('2026-07-05T00:00:00Z'),
  updatedAt: new Date('2026-07-05T00:00:00Z'),
};

describe('RefundService', () => {
  let service: RefundService;

  beforeEach(() => {
    service = new RefundService(mockModuleRef as never);
    Object.values(mockDb.order).forEach((fn) => fn.mockReset());
    Object.values(mockDb.refund).forEach((fn) => fn.mockReset());
    Object.values(mockDb.paymentIntent).forEach((fn) => fn.mockReset());
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
    Object.values(mockOrderService).forEach((fn) => fn.mockReset());
    mockModuleRef.get.mockReset();
  });

  describe('createRefund', () => {
    it('接单后（CONFIRMED）→ PENDING', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue(baseRefund);

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        reasonDetail: 'item damaged',
      });

      expect(result.status).toBe('PENDING');
      expect(result.amount).toBe(10000);
      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 10000,
            status: 'PENDING',
          }),
        }),
      );
      expect(mockOrderService.cancelOrderInternal).not.toHaveBeenCalled();
    });

    it('接单前（PENDING_CONFIRM）→ 自动 COMPLETED + 调 cancelOrderInternal', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING_CONFIRM' });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'COD' });
      mockDb.refund.create.mockResolvedValue({
        ...baseRefund,
        status: 'COMPLETED',
        transactionId: 'MOCK_REFUND_x',
        completedAt: new Date('2026-07-05T00:00:00Z'),
      });
      mockModuleRef.get.mockReturnValue(mockOrderService);
      mockOrderService.cancelOrderInternal.mockResolvedValue(undefined);

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.transactionId).toMatch(/^MOCK_REFUND_/);
      expect(mockOrderService.cancelOrderInternal).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ reason: 'REFUND_AUTO_APPROVED' }),
      );
    });

    it('订单不存在 → E-ORDER-004', async () => {
      mockDb.order.findUnique.mockResolvedValue(null);
      await expect(
        service.createRefund({ orderId: 'nope', userId: 'u1', reason: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('订单不归属 → 403 E-AUTH-012', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, userId: 'other' });
      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('订单已 CANCELLED → E-ORDER-003', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });
      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('已有进行中退款 → E-ORDER-003', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue({ id: 'old-refund', status: 'PENDING' });
      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reviewRefund - APPROVE', () => {
    it('金额一致 → COMPLETED + transactionId', async () => {
      mockDb.refund.findUnique.mockResolvedValue(baseRefund);
      mockDb.order.findUnique.mockResolvedValue({
        payableAmount: 10000,
        status: 'CONFIRMED',
      });
      mockDb.refund.update.mockResolvedValue({
        ...baseRefund,
        status: 'COMPLETED',
        transactionId: 'MOCK_REFUND_x',
        reviewedBy: 'admin-1',
        reviewedAt: new Date('2026-07-05T01:00:00Z'),
        completedAt: new Date('2026-07-05T01:00:00Z'),
      });

      const result = await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(result.status).toBe('COMPLETED');
      expect(result.transactionId).toMatch(/^MOCK_REFUND_/);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('金额 = 0 → E-ORDER-007（防 0 元退款）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, amount: 0 });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: 10000, status: 'CONFIRMED' });

      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(ConflictException);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'REFUND_AMOUNT_INVALID_ZERO_OR_NEGATIVE',
          amount: 0,
        }),
      );
      expect(mockDb.refund.update).not.toHaveBeenCalled();
    });

    it('金额 ≠ order.payableAmount → E-ORDER-007（防超额/不足）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, amount: 9999 });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: 10000, status: 'CONFIRMED' });

      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(ConflictException);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'REFUND_AMOUNT_MISMATCH_ORDER_PAYABLE',
          refundAmount: 9999,
          orderPayableAmount: 10000,
        }),
      );
      expect(mockDb.refund.update).not.toHaveBeenCalled();
    });

    it('订单不存在 → E-ORDER-004（外键理论防住，此为防御）', async () => {
      mockDb.refund.findUnique.mockResolvedValue(baseRefund);
      mockDb.order.findUnique.mockResolvedValue(null);

      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDb.refund.update).not.toHaveBeenCalled();
    });
  });

  describe('reviewRefund - REJECT', () => {
    it('reviewNote 有值 → REJECTED', async () => {
      mockDb.refund.findUnique.mockResolvedValue(baseRefund);
      mockDb.refund.update.mockResolvedValue({
        ...baseRefund,
        status: 'REJECTED',
        reviewedBy: 'admin-1',
        reviewNote: 'invalid reason',
      });

      const result = await service.reviewRefund(
        'refund-1',
        'admin-1',
        'REJECT',
        'invalid reason',
      );

      expect(result.status).toBe('REJECTED');
    });

    it('REJECT 无 reviewNote → E-COMMON-001', async () => {
      mockDb.refund.findUnique.mockResolvedValue(baseRefund);
      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'REJECT'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('reviewRefund - 状态校验', () => {
    it('refund 不存在 → E-ORDER-004', async () => {
      mockDb.refund.findUnique.mockResolvedValue(null);
      await expect(
        service.reviewRefund('nope', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refund 非 PENDING → E-ORDER-003', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'COMPLETED' });
      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelRefund', () => {
    it('PENDING → CANCELLED', async () => {
      mockDb.refund.findUnique.mockResolvedValue(baseRefund);
      mockDb.refund.update.mockResolvedValue({ ...baseRefund, status: 'CANCELLED' });

      const result = await service.cancelRefund('refund-1', 'user-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('不归属 → 403 E-AUTH-012', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, userId: 'other' });
      await expect(service.cancelRefund('refund-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('非 PENDING → E-ORDER-003', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'COMPLETED' });
      await expect(service.cancelRefund('refund-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });
});
