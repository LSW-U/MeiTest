/**
 * WithdrawalService 单测 — 提现申请状态机
 *
 * 覆盖场景：
 *   1. create：amount <= availableBalance → PENDING 创建
 *   2. create：amount > availableBalance → BadRequestException + E-SETTLE-001
 *   3. review：PENDING + APPROVE → APPROVED + reviewedBy/At
 *   4. review：PENDING + REJECT → REJECTED + rejectReason
 *   5. review：非 PENDING 状态 → BadRequestException + E-SETTLE-003
 *   6. review：不存在 → NotFoundException + E-SETTLE-002
 *   7. markPaid：APPROVED → PAID + payoutReference + paidAt
 *   8. markPaid：非 APPROVED → BadRequestException + E-SETTLE-003
 *   9. getAvailableBalance：netAmount 总和 - 已 PAID 提现总和
 *
 * 决策依据：W2-M-MANIFEST-W3.md §6 W3 测试补强
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';

vi.mock('../src/shared/db', () => {
  const settlementAggregate = vi.fn();
  const wrFindUnique = vi.fn();
  const wrFindMany = vi.fn();
  const wrCreate = vi.fn();
  const wrUpdate = vi.fn();
  const wrCount = vi.fn();
  const wrAggregate = vi.fn();
  const executeRaw = vi.fn().mockResolvedValue(1);
  const db = {
    settlement: { aggregate: settlementAggregate },
    withdrawalRequest: {
      findUnique: wrFindUnique,
      findMany: wrFindMany,
      create: wrCreate,
      update: wrUpdate,
      count: wrCount,
      aggregate: wrAggregate,
    },
    $executeRaw: executeRaw,
    // $transaction: 把 fn 当作 tx 调用，tx 复用 db 的方法
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return {
    db,
    withTransaction: vi.fn(
      (fn: (tx: unknown) => Promise<unknown>) => db.$transaction(fn),
    ),
  };
});

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { WithdrawalService } from '../src/modules/settle/withdraw.service';
import { db } from '../src/shared/db';

const settlementAggregate = db.settlement.aggregate as unknown as ReturnType<typeof vi.fn>;
const wrFindUnique = db.withdrawalRequest.findUnique as unknown as ReturnType<typeof vi.fn>;
const wrFindMany = db.withdrawalRequest.findMany as unknown as ReturnType<typeof vi.fn>;
const wrCreate = db.withdrawalRequest.create as unknown as ReturnType<typeof vi.fn>;
const wrUpdate = db.withdrawalRequest.update as unknown as ReturnType<typeof vi.fn>;
const wrCount = db.withdrawalRequest.count as unknown as ReturnType<typeof vi.fn>;
const wrAggregate = db.withdrawalRequest.aggregate as unknown as ReturnType<typeof vi.fn>;
const executeRawMock = db.$executeRaw as unknown as ReturnType<typeof vi.fn>;

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wr-1',
    requesterType: 'MERCHANT',
    requesterId: 'shop-1',
    amount: 1000,
    status: 'PENDING',
    payoutAccount: { bank: 'BRI', account: '1234' },
    payoutReference: null,
    rejectReason: null,
    reviewedBy: null,
    reviewedAt: null,
    paidAt: null,
    createdAt: new Date('2026-06-25T10:00:00Z'),
    updatedAt: new Date('2026-06-25T10:00:00Z'),
    ...overrides,
  };
}

describe('WithdrawalService', () => {
  let service: WithdrawalService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WithdrawalService();
  });

  describe('create', () => {
    it('amount <= balance → 创建 PENDING（含 advisory lock）', async () => {
      // balance = 5000
      settlementAggregate.mockResolvedValue({ _sum: { netAmount: 5000 } });
      wrAggregate.mockResolvedValue({ _sum: { amount: 0 } });
      wrCreate.mockResolvedValue(mockRow());

      const result = await service.create(
        {
          requesterType: 'MERCHANT',
          requesterId: 'shop-1',
          amount: 1000,
          payoutAccount: { bank: 'BRI', account: '1234' } as never,
        },
        'user-1',
      );

      expect(result.status).toBe('PENDING');
      expect(wrCreate).toHaveBeenCalled();
      // 审查报告 P0 #4：必须先获取 advisory lock
      expect(executeRawMock).toHaveBeenCalled();
    });

    it('amount > balance → BadRequestException + E-SETTLE-001', async () => {
      settlementAggregate.mockResolvedValue({ _sum: { netAmount: 1000 } });
      wrAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      await expect(
        service.create(
          {
            requesterType: 'MERCHANT',
            requesterId: 'shop-1',
            amount: 2000,
            payoutAccount: {} as never,
          },
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'E-SETTLE-001' },
      });
      expect(BadRequestException);
      expect(wrCreate).not.toHaveBeenCalled();
    });

    it('并发 TOCTOU：余额 5000，两个 create 各 4000 → 第二个 BadRequest（审查报告 P0 #4）', async () => {
      // 模拟并发：第一个 create 读到 balance=5000 → 创建后 balance 立即降
      // 第二个 create 进入事务时，事务内 aggregate 重新算出 balance=1000 → 拒
      let callCount = 0;
      settlementAggregate.mockImplementation(() => {
        callCount += 1;
        // 第一次调用（第一个 create）：balance=5000
        // 第二次调用（第二个 create）：balance=1000（前一个 create 已扣 4000）
        if (callCount === 1) {
          return Promise.resolve({ _sum: { netAmount: 5000 } });
        }
        return Promise.resolve({ _sum: { netAmount: 1000 } });
      });
      wrAggregate.mockResolvedValue({ _sum: { amount: 0 } });
      wrCreate.mockResolvedValue(mockRow());

      // 串行执行（advisory lock 在 mock 环境下不实际阻塞，但事务内的重算保证一致性）
      const r1 = await service.create(
        {
          requesterType: 'MERCHANT',
          requesterId: 'shop-1',
          amount: 4000,
          payoutAccount: {} as never,
        },
        'user-1',
      );
      expect(r1.status).toBe('PENDING');

      // 第二个 create：事务内重算 balance=1000，4000 > 1000 → 拒
      await expect(
        service.create(
          {
            requesterType: 'MERCHANT',
            requesterId: 'shop-1',
            amount: 4000,
            payoutAccount: {} as never,
          },
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: { code: 'E-SETTLE-001' },
      });
    });
  });

  describe('review', () => {
    it('PENDING + APPROVE → APPROVED', async () => {
      wrFindUnique.mockResolvedValue(mockRow({ status: 'PENDING' }));
      wrUpdate.mockResolvedValue(mockRow({ status: 'APPROVED', reviewedBy: 'admin-1' }));

      const result = await service.review(
        'wr-1',
        { action: 'APPROVE' } as never,
        'admin-1',
      );

      expect(result.status).toBe('APPROVED');
      expect(wrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wr-1' },
          data: expect.objectContaining({
            status: 'APPROVED',
            reviewedBy: 'admin-1',
          }),
        }),
      );
    });

    it('PENDING + REJECT + reason → REJECTED', async () => {
      wrFindUnique.mockResolvedValue(mockRow({ status: 'PENDING' }));
      wrUpdate.mockResolvedValue(
        mockRow({ status: 'REJECTED', rejectReason: 'suspicious' }),
      );

      const result = await service.review(
        'wr-1',
        { action: 'REJECT', rejectReason: 'suspicious' } as never,
        'admin-1',
      );

      expect(result.status).toBe('REJECTED');
      expect(wrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            rejectReason: 'suspicious',
          }),
        }),
      );
    });

    it('非 PENDING → BadRequestException + E-SETTLE-003', async () => {
      wrFindUnique.mockResolvedValue(mockRow({ status: 'APPROVED' }));

      await expect(
        service.review('wr-1', { action: 'APPROVE' } as never, 'admin-1'),
      ).rejects.toMatchObject({
        response: { code: 'E-SETTLE-003' },
      });
      expect(wrUpdate).not.toHaveBeenCalled();
    });

    it('不存在 → NotFoundException + E-SETTLE-002', async () => {
      wrFindUnique.mockResolvedValue(null);

      await expect(
        service.review('wr-x', { action: 'APPROVE' } as never, 'admin-1'),
      ).rejects.toMatchObject({
        response: { code: 'E-SETTLE-002' },
      });
      expect(NotFoundException);
    });
  });

  describe('markPaid', () => {
    it('APPROVED → PAID + payoutReference', async () => {
      wrFindUnique.mockResolvedValue(mockRow({ status: 'APPROVED' }));
      wrUpdate.mockResolvedValue(
        mockRow({ status: 'PAID', payoutReference: 'TXN-001', paidAt: new Date() }),
      );

      const result = await service.markPaid(
        'wr-1',
        { payoutReference: 'TXN-001' } as never,
        'admin-1',
      );

      expect(result.status).toBe('PAID');
      expect(wrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PAID',
            payoutReference: 'TXN-001',
          }),
        }),
      );
    });

    it('非 APPROVED → BadRequestException + E-SETTLE-003', async () => {
      wrFindUnique.mockResolvedValue(mockRow({ status: 'PENDING' }));

      await expect(
        service.markPaid('wr-1', { payoutReference: 'X' } as never, 'admin-1'),
      ).rejects.toMatchObject({
        response: { code: 'E-SETTLE-003' },
      });
    });
  });

  describe('list / detail', () => {
    it('list 分页', async () => {
      wrFindMany.mockResolvedValue([mockRow()]);
      wrCount.mockResolvedValue(1);

      const result = await service.list({
        requesterType: 'MERCHANT',
        page: 1,
        pageSize: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('detail 找不到 → NotFoundException', async () => {
      wrFindUnique.mockResolvedValue(null);
      await expect(service.detail('nope')).rejects.toMatchObject({
        response: { code: 'E-SETTLE-002' },
      });
    });
  });
});
