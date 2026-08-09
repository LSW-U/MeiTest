/**
 * AdminPaymentController 单测（批次 3 审查 P2，2026-08-10）
 *
 * 覆盖 controller 层事务编排（payment.service:262-278 警告的核心风险点）：
 *   1. confirm-receipt 成功：markPaidByAdminTx + markPaidTx 同事务（同一 tx）+ postMarkPaidEffects 事务后调
 *   2. markPaidTx 抛错 → 整事务抛错 + postMarkPaidEffects 不调（原子性，PaymentIntent 不留 PAID）
 *   3. postMarkPaidEffects 抛错 → 主事务方法仍被调用（副作用容忍，主事务不回滚）
 *   4. mark-failed 成功：调 markFailedByAdmin + reason 透传
 *   5. req.user 缺失 → E-AUTH-002（confirm-receipt + mark-failed 双兜底）
 *
 * service 层状态机/校验由 payment.service.test.ts 覆盖，这里只测 controller 装配 + 事务编排
 *
 * mock：db.order.findUnique（事务外查 order）、withTransaction（执行 fn 传 fake tx）、
 *       PaymentService/OrderService（class 方法 = mock fn）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPaymentService, mockOrderService, mockDb, mockWithTransaction, mockTx } =
  vi.hoisted(() => ({
    mockPaymentService: {
      markPaidByAdminTx: vi.fn(),
      markFailedByAdmin: vi.fn(),
    },
    mockOrderService: {
      markPaidTx: vi.fn(),
      postMarkPaidEffects: vi.fn(),
    },
    mockDb: {
      order: { findUnique: vi.fn() },
    },
    mockWithTransaction: vi.fn(),
    // fake tx：仅用于断言「同事务方法都拿到同一个 tx」，不实际访问 DB
    mockTx: { __isTx: true } as unknown as import('../src/shared/db/transaction').Tx,
  }));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/db/transaction', () => ({
  withTransaction: mockWithTransaction,
}));

vi.mock('../src/modules/payment/payment.service', () => ({
  PaymentService: class {
    markPaidByAdminTx = mockPaymentService.markPaidByAdminTx;
    markFailedByAdmin = mockPaymentService.markFailedByAdmin;
  },
}));
vi.mock('../src/modules/order/order.service', () => ({
  OrderService: class {
    markPaidTx = mockOrderService.markPaidTx;
    postMarkPaidEffects = mockOrderService.postMarkPaidEffects;
  },
}));

import { AdminPaymentController } from '../src/modules/payment/admin-payment.controller';
import { PaymentService } from '../src/modules/payment/payment.service';
import { OrderService } from '../src/modules/order/order.service';

describe('AdminPaymentController - 事务编排 + 装配（批次 3 审查 P2）', () => {
  let controller: AdminPaymentController;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 withTransaction：执行 fn 传 mockTx（fn 内抛错则 withTransaction 抛错，模拟真实回滚）
    mockWithTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
      fn(mockTx),
    );
    // 默认事务外查 order 返回 mock order（postMarkPaidEffects 通知用）
    mockDb.order.findUnique.mockResolvedValue({
      id: 'o-1',
      userId: 'u-1',
      orderNo: 'MM20260810W01000001',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
    });
    controller = new AdminPaymentController(
      new PaymentService() as never,
      new OrderService() as never,
    );
  });

  it('confirm-receipt 成功：markPaidByAdminTx + markPaidTx 同事务（同一 tx）+ postMarkPaidEffects 事务后调', async () => {
    const intentView = { id: 'pi-1', orderId: 'o-1', status: 'PAID', amount: 5800 };
    mockPaymentService.markPaidByAdminTx.mockResolvedValue(intentView);
    mockOrderService.markPaidTx.mockResolvedValue(undefined);
    mockOrderService.postMarkPaidEffects.mockResolvedValue(undefined);

    const result = await controller.confirmReceipt(
      'o-1',
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } } as never,
      'platform',
    );

    // 事务外查 order（通知用）
    expect(mockDb.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      select: expect.objectContaining({ userId: true, orderNo: true }),
    });
    // 事务内：markPaidByAdminTx + markPaidTx 用同一 tx（原子性核心）
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(mockPaymentService.markPaidByAdminTx).toHaveBeenCalledWith(
      mockTx,
      'o-1',
      'admin-1',
    );
    expect(mockOrderService.markPaidTx).toHaveBeenCalledWith(
      mockTx,
      'o-1',
      expect.objectContaining({
        operatorId: 'admin-1',
        perspective: 'platform',
        metadata: { source: 'admin_confirm_receipt' },
      }),
    );
    // 事务后：postMarkPaidEffects（避嵌套事务）
    expect(mockOrderService.postMarkPaidEffects).toHaveBeenCalledTimes(1);
    expect(mockOrderService.postMarkPaidEffects).toHaveBeenCalledWith(
      'o-1',
      expect.objectContaining({ operatorId: 'admin-1' }),
      expect.objectContaining({ id: 'o-1', orderNo: 'MM20260810W01000001' }),
    );
    // 返回 intentView
    expect(result).toEqual({ success: true as const, data: intentView });
  });

  it('confirm-receipt：markPaidTx 抛错 → 整事务抛错 + postMarkPaidEffects 不调（原子性，PaymentIntent 不留 PAID）', async () => {
    mockPaymentService.markPaidByAdminTx.mockResolvedValue({ id: 'pi-1' });
    mockOrderService.markPaidTx.mockRejectedValue(new Error('order status conflict'));

    await expect(
      controller.confirmReceipt(
        'o-1',
        { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } } as never,
        'platform',
      ),
    ).rejects.toThrow('order status conflict');

    // markPaidByAdminTx 被调（事务内），但 postMarkPaidEffects 不调（事务回滚）
    expect(mockPaymentService.markPaidByAdminTx).toHaveBeenCalledTimes(1);
    expect(mockOrderService.markPaidTx).toHaveBeenCalledTimes(1);
    expect(mockOrderService.postMarkPaidEffects).not.toHaveBeenCalled();
  });

  it('confirm-receipt：postMarkPaidEffects 抛错 → 主事务方法仍被调用（副作用容忍，主事务不回滚）', async () => {
    mockPaymentService.markPaidByAdminTx.mockResolvedValue({ id: 'pi-1' });
    mockOrderService.markPaidTx.mockResolvedValue(undefined);
    mockOrderService.postMarkPaidEffects.mockRejectedValue(
      new Error('notify service down'),
    );

    // postMarkPaidEffects 错误冒出来（controller 不吞），但主事务已完成（PAID+CONFIRMED 已落库）
    await expect(
      controller.confirmReceipt(
        'o-1',
        { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } } as never,
        'platform',
      ),
    ).rejects.toThrow('notify service down');

    // 关键：主事务方法均已调用（withTransaction 已完成 → 事务提交），postMarkPaidEffects 失败不回滚主事务
    expect(mockPaymentService.markPaidByAdminTx).toHaveBeenCalledTimes(1);
    expect(mockOrderService.markPaidTx).toHaveBeenCalledTimes(1);
    expect(mockOrderService.postMarkPaidEffects).toHaveBeenCalledTimes(1);
  });

  it('mark-failed 成功：调 markFailedByAdmin + orderId/adminUserId/reason 透传', async () => {
    const intentView = { id: 'pi-1', orderId: 'o-1', status: 'FAILED' };
    mockPaymentService.markFailedByAdmin.mockResolvedValue(intentView);

    const result = await controller.markFailed(
      'o-1',
      { reason: 'bank transfer rejected' },
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } } as never,
    );

    expect(mockPaymentService.markFailedByAdmin).toHaveBeenCalledWith(
      'o-1',
      'admin-1',
      'bank transfer rejected',
    );
    expect(result).toEqual({ success: true as const, data: intentView });
  });

  it('req.user 缺失 → E-AUTH-002（confirm-receipt + mark-failed 双兜底，service 不调）', async () => {
    // confirm-receipt
    await expect(
      controller.confirmReceipt('o-1', {} as never, 'platform'),
    ).rejects.toMatchObject({
      response: { code: 'E-AUTH-002' },
    });
    // mark-failed
    await expect(
      controller.markFailed('o-1', { reason: 'x' }, {} as never),
    ).rejects.toMatchObject({
      response: { code: 'E-AUTH-002' },
    });

    // 两个写操作的 service 都未触达
    expect(mockPaymentService.markPaidByAdminTx).not.toHaveBeenCalled();
    expect(mockPaymentService.markFailedByAdmin).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
