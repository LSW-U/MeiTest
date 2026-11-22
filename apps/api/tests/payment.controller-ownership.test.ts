/**
 * PaymentController 归属校验单测（P1-2，批1）
 *
 * 覆盖（方案 v2 §五 A1.1/A1.2）：
 *   - getIntent：本人 200 / 他人 404 E-ORDER-004 / 未登录 E-AUTH-002 / 订单不存在 404（防枚举同码）
 *   - uploadReceipt：本人正常 / 他人覆写凭证被拒 404 / 未登录 E-AUTH-002
 *
 * 归属校验在 controller（借 refund/order 模式，payment 模块零先例），mock OrderService + PaymentService。
 * 注意 controller 内部接口 RequestWithUser = { user?: RequestUser }。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

const { mockPaymentService, mockOrderService } = vi.hoisted(() => ({
  mockPaymentService: {
    getIntentByOrder: vi.fn(),
    uploadReceipt: vi.fn(),
  },
  mockOrderService: {
    getOrderForOwnership: vi.fn(),
    markPaid: vi.fn(),
  },
}));

vi.mock('../src/modules/payment/payment.service', () => ({
  PAYMENT_SERVICE_TOKEN: 'PAYMENT_SERVICE_TOKEN',
  PaymentService: class {
    getIntentByOrder = mockPaymentService.getIntentByOrder;
    uploadReceipt = mockPaymentService.uploadReceipt;
  },
}));
vi.mock('../src/modules/order/order.service', () => ({
  OrderService: class {
    getOrderForOwnership = mockOrderService.getOrderForOwnership;
    markPaid = mockOrderService.markPaid;
  },
}));

import { PaymentController } from '../src/modules/payment/payment.controller';
import { PaymentService } from '../src/modules/payment/payment.service';
import { OrderService } from '../src/modules/order/order.service';

const intentView = {
  id: 'intent-1',
  orderId: 'order-1',
  method: 'BANK_TRANSFER',
  status: 'PENDING',
  amount: 10000,
  transactionId: null,
  clientSecret: null,
  mockFlag: false,
  receiptUrl: null,
  paidAt: null,
};

function reqWith(sub?: string): never {
  return (sub ? { user: { sub, role: 'CUSTOMER', deviceType: 'client_app' } } : {}) as never;
}

describe('PaymentController - 归属校验（P1-2）', () => {
  let controller: PaymentController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PaymentController(
      new PaymentService() as never,
      new OrderService(null as never) as never,
    );
  });

  describe('getIntent', () => {
    it('本人订单 → 返回 intent', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue({ userId: 'u-1' });
      mockPaymentService.getIntentByOrder.mockResolvedValue(intentView);

      const result = await controller.getIntent('order-1', reqWith('u-1'));

      expect(result).toEqual({ success: true, data: intentView });
      expect(mockPaymentService.getIntentByOrder).toHaveBeenCalledWith('order-1');
    });

    it('他人订单 → 404 E-ORDER-004（防枚举，不调 paymentService）', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue({ userId: 'other' });

      const err = await controller.getIntent('order-1', reqWith('u-1')).catch((e: HttpException) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getResponse()).toMatchObject({ code: 'E-ORDER-004' });
      expect(mockPaymentService.getIntentByOrder).not.toHaveBeenCalled();
    });

    it('订单不存在 → 404 E-ORDER-004 同码（不区分不存在/非本人）', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue(null);

      const err = await controller.getIntent('order-404', reqWith('u-1')).catch((e: HttpException) => e);
      expect(err.getResponse()).toMatchObject({ code: 'E-ORDER-004' });
    });

    it('未登录 → E-AUTH-002', async () => {
      const err = await controller.getIntent('order-1', reqWith()).catch((e: HttpException) => e);
      expect(err.getResponse()).toMatchObject({ code: 'E-AUTH-002' });
      expect(mockOrderService.getOrderForOwnership).not.toHaveBeenCalled();
    });
  });

  describe('uploadReceipt', () => {
    const body = { receiptUrl: 'http://localhost:9000/meimart/receipt.jpg' } as never;

    it('本人订单 → 正常上传凭证', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue({ userId: 'u-1' });
      mockPaymentService.uploadReceipt.mockResolvedValue({ ...intentView, receiptUrl: body.receiptUrl });

      const result = await controller.uploadReceipt('order-1', body, reqWith('u-1'));

      expect(result.success).toBe(true);
      expect(mockPaymentService.uploadReceipt).toHaveBeenCalledWith('order-1', body.receiptUrl);
    });

    it('他人订单覆写凭证 → 404 E-ORDER-004，不调 uploadReceipt', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue({ userId: 'other' });

      const err = await controller.uploadReceipt('order-1', body, reqWith('u-1')).catch(
        (e: HttpException) => e,
      );
      expect(err.getResponse()).toMatchObject({ code: 'E-ORDER-004' });
      expect(mockPaymentService.uploadReceipt).not.toHaveBeenCalled();
    });

    it('未登录 → E-AUTH-002', async () => {
      const err = await controller.uploadReceipt('order-1', body, reqWith()).catch((e: HttpException) => e);
      expect(err.getResponse()).toMatchObject({ code: 'E-AUTH-002' });
      expect(mockPaymentService.uploadReceipt).not.toHaveBeenCalled();
    });
  });

  // 批2 P1-C（20261122）：confirmPaid 越权确认收口——登录 + 本人，404 防枚举
  describe('confirmPaid（批2 P1-C）', () => {
    const paidIntent = { ...intentView, status: 'PAID' };

    it('本人订单 PAID → markPaid 成功，operatorId 传本人 sub', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue({ userId: 'u-1' });
      mockPaymentService.getIntentByOrder.mockResolvedValue(paidIntent);
      mockOrderService.markPaid.mockResolvedValue(undefined);

      const result = await controller.confirmPaid('order-1', reqWith('u-1'));

      expect(result).toEqual({ success: true, data: { orderId: 'order-1', status: 'CONFIRMED' } });
      expect(mockOrderService.markPaid).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ operatorId: 'u-1', metadata: { intentId: 'intent-1', source: 'client_confirm' } }),
      );
    });

    it('他人订单 → 404 E-ORDER-004（防枚举），不读 intent 不调 markPaid', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue({ userId: 'other' });

      const err = await controller.confirmPaid('order-1', reqWith('u-1')).catch((e: HttpException) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getResponse()).toMatchObject({ code: 'E-ORDER-004' });
      expect(mockPaymentService.getIntentByOrder).not.toHaveBeenCalled();
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });

    it('订单不存在 → 404 E-ORDER-004 同码（防枚举）', async () => {
      mockOrderService.getOrderForOwnership.mockResolvedValue(null);

      const err = await controller.confirmPaid('order-404', reqWith('u-1')).catch((e: HttpException) => e);
      expect(err.getResponse()).toMatchObject({ code: 'E-ORDER-004' });
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });

    it('未登录 → E-AUTH-002', async () => {
      const err = await controller.confirmPaid('order-1', reqWith()).catch((e: HttpException) => e);
      expect(err.getResponse()).toMatchObject({ code: 'E-AUTH-002' });
      expect(mockOrderService.getOrderForOwnership).not.toHaveBeenCalled();
      expect(mockOrderService.markPaid).not.toHaveBeenCalled();
    });
  });
});
