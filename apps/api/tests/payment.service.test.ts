/**
 * Payment Service — mockCallback 单测
 *
 * 覆盖：
 *   - prod 守卫（NODE_ENV=production 时拒绝）
 *   - method 校验（仅 WECHAT/PAYPAL/STRIPE）
 *   - 幂等（已 PAID 时直接返回不重复更新）
 *   - 状态流转（PENDING/PROCESSING → PAID）
 *   - intent not found 抛 E-PAYMENT-005
 *   - 错误状态抛 E-PAYMENT-008
 *
 * mock：db.paymentIntent（findUnique / update），getPaymentStrategy 不调用（mockCallback 不走 strategy）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));

import { PaymentService } from '../src/modules/payment/payment.service';

describe('PaymentService.mockCallback', () => {
  let service: PaymentService;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    service = new PaymentService();
    mockDb.paymentIntent.findUnique.mockReset();
    mockDb.paymentIntent.update.mockReset();
    process.env.NODE_ENV = 'development'; // 默认 dev
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('prod 环境拒绝 mockCallback（E-PAYMENT-006）', async () => {
    process.env.NODE_ENV = 'production';

    await expect(service.mockCallback('order-1')).rejects.toThrow(/E-PAYMENT-006|Mock callback disabled/);
    expect(mockDb.paymentIntent.findUnique).not.toHaveBeenCalled();
  });

  it('intent 不存在时抛 E-PAYMENT-005', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(null);

    await expect(service.mockCallback('order-1')).rejects.toThrow(/E-PAYMENT-005|Payment intent not found/);
  });

  it('COD method 拒绝 mockCallback（E-PAYMENT-007）', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'COD',
      status: 'PENDING',
    });

    await expect(service.mockCallback('order-1')).rejects.toThrow(/Mock callback only available for WECHAT\/PAYPAL\/STRIPE/);
  });

  it('BANK_TRANSFER method 拒绝 mockCallback（E-PAYMENT-007）', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'BANK_TRANSFER',
      status: 'PENDING',
    });

    await expect(service.mockCallback('order-1')).rejects.toThrow(/Mock callback only available for WECHAT\/PAYPAL\/STRIPE/);
  });

  it('已 PAID 时幂等返回（不调 update）', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'WECHAT',
      status: 'PAID',
    });

    const result = await service.mockCallback('order-1');
    expect(result).toEqual({ orderId: 'order-1', intentId: 'intent-1' });
    expect(mockDb.paymentIntent.update).not.toHaveBeenCalled();
  });

  it('FAILED 状态拒绝回调（E-PAYMENT-008）', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'WECHAT',
      status: 'FAILED',
    });

    await expect(service.mockCallback('order-1')).rejects.toThrow(/cannot receive mock callback/);
  });

  it('REFUNDED 状态拒绝回调（E-PAYMENT-008）', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'PAYPAL',
      status: 'REFUNDED',
    });

    await expect(service.mockCallback('order-1')).rejects.toThrow(/cannot receive mock callback/);
  });

  it('CANCELLED 状态拒绝回调（E-PAYMENT-008）', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'STRIPE',
      status: 'CANCELLED',
    });

    await expect(service.mockCallback('order-1')).rejects.toThrow(/cannot receive mock callback/);
  });

  it('WECHAT PENDING → 调 update 置 PAID', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'WECHAT',
      status: 'PENDING',
      amount: 5800,
      providerPayload: null,
    });
    mockDb.paymentIntent.update.mockResolvedValue({
      id: 'intent-1',
      orderId: 'order-1',
      method: 'WECHAT',
      status: 'PAID',
      amount: 5800,
      providerPayload: { mock: true },
    });

    const result = await service.mockCallback('order-1');

    expect(mockDb.paymentIntent.update).toHaveBeenCalledTimes(1);
    // Prisma update 签名：update({ where, data })
    const [arg] = mockDb.paymentIntent.update.mock.calls[0]!;
    expect(arg.where).toEqual({ id: 'intent-1' });
    expect(arg.data.status).toBe('PAID');
    expect(arg.data.paidAt).toBeInstanceOf(Date);
    expect(result).toEqual({ orderId: 'order-1', intentId: 'intent-1' });
  });

  it('PAYPAL PROCESSING → 调 update 置 PAID', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-2',
      orderId: 'order-2',
      method: 'PAYPAL',
      status: 'PROCESSING',
      amount: 10000,
      providerPayload: null,
    });
    mockDb.paymentIntent.update.mockResolvedValue({
      id: 'intent-2',
      orderId: 'order-2',
      method: 'PAYPAL',
      status: 'PAID',
      amount: 10000,
    });

    const result = await service.mockCallback('order-2');
    expect(result).toEqual({ orderId: 'order-2', intentId: 'intent-2' });
    expect(mockDb.paymentIntent.update).toHaveBeenCalled();
  });

  it('STRIPE PENDING → 调 update 置 PAID', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-3',
      orderId: 'order-3',
      method: 'STRIPE',
      status: 'PENDING',
      amount: 20000,
      providerPayload: null,
    });
    mockDb.paymentIntent.update.mockResolvedValue({
      id: 'intent-3',
      orderId: 'order-3',
      method: 'STRIPE',
      status: 'PAID',
    });

    const result = await service.mockCallback('order-3');
    expect(result).toEqual({ orderId: 'order-3', intentId: 'intent-3' });
  });
});
