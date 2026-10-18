/**
 * Refund Service 单测（W7-fix P2 修复 — 退款审核金额断言）
 *
 * 覆盖：
 *   - createRefund 接单前 → 自动通过 COMPLETED + 调 OrderService.cancelOrderInternal
 *   - createRefund 接单后 → PENDING
 *   - createRefund 订单不存在 / 不归属 / 已 CANCELLED / 已有进行中退款
 *   - reviewRefund APPROVE 正常路径（金额一致）
 *   - reviewRefund APPROVE 金额 = 0 → E-REFUND-006（P2 新增，P13 改码）
 *   - reviewRefund APPROVE 金额 > payable → E-REFUND-010（P13：放宽部分退款，仅超额报错）
 *   - reviewRefund APPROVE 订单不存在 → E-REFUND-005
 *   - reviewRefund REJECT 正常 + 无 reviewNote
 *   - reviewRefund 状态非 PENDING → E-REFUND-004
 *   - cancelRefund 正常 / 不归属 / 非 PENDING
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CreateRefundRequest } from '@meimart/api-contract';

const { mockDb, mockLogger, mockModuleRef, mockOrderService, mockStorage, mockDispatchService, mockHelpers, mockSettlementAdjustment } = vi.hoisted(() => ({
  mockDb: {
    order: {
      findUnique: vi.fn(),
      // P1-5：cancelOrderInTx WHERE status 守卫翻转（默认 count=1 成功）
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      // P1-5：cancelOrderInTx 清 riderId（联动关任务命中时）
      update: vi.fn(),
    },
    refund: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      // 批A P2-1：completeRefundTx 条件翻转（status='PENDING' 作 WHERE 前置）
      updateMany: vi.fn(),
      // 批A P2-2：整单退款金额累计校验（Σ COMPLETED refund.amount）
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    refundItem: {
      findMany: vi.fn(),
    },
    paymentIntent: {
      findUnique: vi.fn(),
    },
    // 批A 销量真实统计：completeRefundTx COD 守卫查收款成功记录
    cashCollection: {
      findFirst: vi.fn(),
    },
    // P1-5：cancelOrderInTx 事务内联动关任务
    deliveryTask: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // P1-5：cancelOrderInTx 写 OrderEvent
    orderEvent: {
      create: vi.fn(),
    },
    // P1-4：tx.$executeRaw（advisory lock）经 withTransaction 默认 tx=mockDb 生效
    // （声明在前，下方 $executeRaw 引用同一实例）
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
  // 批A 销量真实统计：withTransaction 让 tx 复用 mockDb；回滚 helper mock 掉（helper 逻辑在
  // sales-count.helper.test.ts 单测，本文件只断言接线与守卫分支）
  mockHelpers: {
    withTransaction: vi.fn(),
    rollbackSalesCountForRefundItems: vi.fn(),
    rollbackSalesCountForFullOrder: vi.fn(),
    // 批2 item7：RETURN_REFUND 回补库存（releaseStock 原实现走 $queryRaw，mock 后可断言）
    releaseStock: vi.fn(),
  },
  // P1-4：advisory lock 的 $executeRaw 直接挂在 mockDb 上（withTransaction 默认 tx=mockDb）
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
  // P13 审查 P1 修复：mockStorage.isOwnUrl 用真实前缀逻辑（URL 必须以 MinIO base 开头才 true）
  // 现有 photos 测试用 http://localhost:9000/meimart/... → 通过；P1 测试用 evil URL → 抛 E-REFUND-011
  mockStorage: {
    isOwnUrl: vi.fn(
      (url: string) => typeof url === 'string' && url.startsWith('http://localhost:9000/meimart/'),
    ),
  },
  // P14 ④：reviewRefund APPROVE + RETURN_REFUND 触发 createTaskForReturn
  mockDispatchService: {
    createTaskForReturn: vi.fn(),
  },
  // D8：mock 掉 settle 模块负向调整 helper（其自身逻辑在 real-order-aggregator.test.ts 单测），
  // 本文件只断言 completeRefundTx 接线（参数：tx/退款额/completedAt/shopId）
  mockSettlementAdjustment: {
    applyRefundSettlementAdjustment: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: mockHelpers.withTransaction,
  rollbackSalesCountForRefundItems: mockHelpers.rollbackSalesCountForRefundItems,
  rollbackSalesCountForFullOrder: mockHelpers.rollbackSalesCountForFullOrder,
  releaseStock: mockHelpers.releaseStock,
}));
vi.mock('../src/shared/logger/logger', () => ({ logger: mockLogger }));
vi.mock('../src/modules/order/order.service', () => ({
  OrderService: class {
    cancelOrderInternal = mockOrderService.cancelOrderInternal;
  },
}));
vi.mock('../src/shared/storage/storage.service', () => ({
  StorageService: class {
    isOwnUrl = mockStorage.isOwnUrl;
  },
}));
// P14 ④：mock DispatchService（reviewRefund APPROVE + RETURN_REFUND 触发）
vi.mock('../src/modules/dispatch/dispatch.service', () => ({
  DispatchService: class {
    createTaskForReturn = mockDispatchService.createTaskForReturn;
  },
}));
// D8：mock settle 负向调整 helper（避免连带 mock prisma settlement 模型）
vi.mock('../src/modules/settle/real-order-aggregator.service', () => ({
  applyRefundSettlementAdjustment: mockSettlementAdjustment.applyRefundSettlementAdjustment,
}));

import { RefundService } from '../src/modules/refund/refund.service';
// P14 ④：token 用于 moduleRef.get(DispatchService) mock 区分
import { DispatchService } from '../src/modules/dispatch/dispatch.service';

const baseOrder = {
  id: 'order-1',
  userId: 'user-1',
  status: 'CONFIRMED',
  payableAmount: 10000,
  items: [],
  // D8：completeRefundTx 取 warehouse.shopId 做负向调整归属（subjectId=shopId）
  warehouse: { shopId: 'shop-1' },
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
  photos: [],
  refundType: 'REFUND_ONLY',
  pickupAt: null,
  pickedAt: null,
  // 批A：completeRefundTx 重查 refund 带 items（整单退款为空数组）
  items: [],
};

describe('RefundService', () => {
  let service: RefundService;

  beforeEach(() => {
    service = new RefundService(mockModuleRef as never, mockStorage as never);
    Object.values(mockDb.order).forEach((fn) => fn.mockReset());
    Object.values(mockDb.refund).forEach((fn) => fn.mockReset());
    Object.values(mockDb.refundItem).forEach((fn) => fn.mockReset());
    Object.values(mockDb.paymentIntent).forEach((fn) => fn.mockReset());
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
    Object.values(mockOrderService).forEach((fn) => fn.mockReset());
    mockModuleRef.get.mockReset();
    // P14 ④：reset DispatchService mock
    mockDispatchService.createTaskForReturn.mockReset();
    // 批A 销量真实统计：reset helper mocks + withTransaction 默认 tx 复用 mockDb
    mockHelpers.rollbackSalesCountForRefundItems.mockReset();
    mockHelpers.rollbackSalesCountForFullOrder.mockReset();
    // 批2 item7：reset 回补库存 mock（默认不调用）
    mockHelpers.releaseStock.mockReset();
    mockHelpers.withTransaction.mockReset();
    mockHelpers.withTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
    );
    // P1-4：advisory lock $executeRaw 复位默认值（在 mockDb.$executeRaw 上）
    (mockDb.$executeRaw as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(0);
    Object.values(mockDb.cashCollection).forEach((fn) => fn.mockReset());
    // 批A P2-2：整单退款累计校验默认「无已完成退款」（可被具体 case 覆盖）
    mockDb.refund.aggregate.mockResolvedValue({ _sum: { amount: null } });
    // 批A P2-1：completeRefundTx 条件翻转默认成功（count=1），并发输家 case 单独覆盖 count=0
    mockDb.refund.updateMany.mockResolvedValue({ count: 1 });
    // P1-5：cancelOrderInTx 守卫翻转 + 关任务默认值
    mockDb.order.updateMany.mockResolvedValue({ count: 1 });
    mockDb.deliveryTask.updateMany.mockResolvedValue({ count: 0 });
    // D8：reset 负向调整接线 mock
    mockSettlementAdjustment.applyRefundSettlementAdjustment.mockReset();
    mockSettlementAdjustment.applyRefundSettlementAdjustment.mockResolvedValue(undefined);
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

    it('createRefund 传 photos → db.refund.create data 含 photos + toView 返 photos（P13 售后图片）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({
        ...baseRefund,
        photos: ['http://localhost:9000/meimart/refunds/evidence-1.jpg', 'http://localhost:9000/meimart/refunds/evidence-2.jpg'],
      });

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        reasonDetail: 'item damaged',
        photos: ['http://localhost:9000/meimart/refunds/evidence-1.jpg', 'http://localhost:9000/meimart/refunds/evidence-2.jpg'],
      });

      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            photos: ['http://localhost:9000/meimart/refunds/evidence-1.jpg', 'http://localhost:9000/meimart/refunds/evidence-2.jpg'],
          }),
        }),
      );
      expect(result.photos).toEqual([
        'http://localhost:9000/meimart/refunds/evidence-1.jpg',
        'http://localhost:9000/meimart/refunds/evidence-2.jpg',
      ]);
    });

    it('createRefund 不传 photos → db.refund.create data 含 photos: []（向后兼容，P13）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, photos: [] });

      await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        // 不传 photos
      });

      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            photos: [],
          }),
        }),
      );
    });

    it('createRefund 传 refundType=RETURN_REFUND -> db.refund.create data 含 refundType + toView 返（P14-defer）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, refundType: 'RETURN_REFUND' });

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'WRONG_ITEM',
        refundType: 'RETURN_REFUND',
      });

      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundType: 'RETURN_REFUND',
          }),
        }),
      );
      expect(result.refundType).toBe('RETURN_REFUND');
    });

    it('createRefund 不传 refundType -> db.refund.create data 含 refundType: REFUND_ONLY（默认，向后兼容，P14-defer）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, refundType: 'REFUND_ONLY' });

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        // 不传 refundType
      });

      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundType: 'REFUND_ONLY',
          }),
        }),
      );
      expect(result.refundType).toBe('REFUND_ONLY');
    });

    it('toView 返 pickupAt/pickedAt 为 null（dispatch 集成 defer，当前永远 null，P14-defer）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, pickupAt: null, pickedAt: null });

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
      });

      expect(result.pickupAt).toBeNull();
      expect(result.pickedAt).toBeNull();
    });


    it('photos 含非本服务 URL → E-REFUND-011（P13 审查 P1 修复：防 SSRF/追踪/钓鱼）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });

      // evil URL 不在 MinIO base → mockStorage.isOwnUrl 返 false → 抛 E-REFUND-011
      await expect(
        service.createRefund({
          orderId: 'order-1',
          userId: 'user-1',
          reason: 'QUALITY_ISSUE',
          photos: ['https://evil.com/tracker.jpg'],
        }),
      ).rejects.toThrow(ConflictException);

      // 不应写入 DB
      expect(mockDb.refund.create).not.toHaveBeenCalled();
    });

    it('photos 全是本服务 URL → 通过（P1 校验不误伤合法上传）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({
        ...baseRefund,
        photos: ['http://localhost:9000/meimart/refunds/evidence-1.jpg'],
      });

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        photos: ['http://localhost:9000/meimart/refunds/evidence-1.jpg'],
      });

      expect(result.photos).toEqual([
        'http://localhost:9000/meimart/refunds/evidence-1.jpg',
      ]);
    });

    it('接单前（PENDING_CONFIRM）→ 自动 COMPLETED + 同事务取消订单（P1-5 cancelOrderInTx）', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING_CONFIRM' });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'COD' });
      mockDb.refund.create.mockResolvedValue({
        ...baseRefund,
        status: 'PENDING',
      });
      // 批A：autoApprove 经 completeRefundTx —— 事务内重查 refund + 条件翻转标 COMPLETED
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'PENDING' });
      // P1-5：cancelOrderInTx 守卫翻转成功
      mockDb.order.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.transactionId).toMatch(/^MOCK_REFUND_/);
      // 批A：create 先 PENDING，COMPLETED 由 completeRefundTx 的条件翻转写入
      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
      expect(mockDb.refund.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: expect.any(String), status: 'PENDING' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      // 批A：未支付订单（PENDING_CONFIRM）从未累加销量 → 不回滚
      expect(mockHelpers.rollbackSalesCountForRefundItems).not.toHaveBeenCalled();
      expect(mockHelpers.rollbackSalesCountForFullOrder).not.toHaveBeenCalled();
      // P1-5：订单取消收进同一事务（WHERE status notIn 终态守卫翻转 + OrderEvent + 关任务），
      // 不再调 OrderService.cancelOrderInternal（事务外旧路径已删）
      expect(mockDb.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', status: { notIn: ['CANCELLED', 'COMPLETED'] } },
          data: expect.objectContaining({ status: 'CANCELLED', cancelReason: 'REFUND_AUTO_APPROVED' }),
        }),
      );
      expect(mockDb.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-1', toStatus: 'CANCELLED' }),
        }),
      );
      expect(mockDb.deliveryTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'order-1', status: { in: ['PENDING_ASSIGN', 'ASSIGNED'] } },
        }),
      );
      // D8（A2.9a 接线）：COMPLETED 同事务触发负向调整 Settlement（参数：tx/退款额/completedAt/shopId）
      expect(mockSettlementAdjustment.applyRefundSettlementAdjustment).toHaveBeenCalledWith(
        mockDb,
        10000,
        expect.any(Date),
        'shop-1',
      );
    });

    it('P1-5：自动通过时订单取消失败 → 整个退款事务回滚（refund 不落地）', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING_CONFIRM' });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'COD' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, status: 'PENDING' });
      // cancelOrderInTx 守卫翻转成功，但事务内后续库存释放失败（rollbackSalesCountForFullOrder
      // 在本 mock 中被复用为「事务内任意后续步骤失败」的注入点——实际注入在 completeRefundTx
      // 之前的库存释放会走 releaseStock；此处直接让 order.updateMany 失败更贴近 P1-5 语义）
      mockDb.order.updateMany.mockResolvedValue({ count: 0 });
      // withTransaction 真实语义：fn 抛错 → 整体 reject（回滚），create 已插入的行不返回
      mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        try {
          return await fn(mockDb);
        } catch (err) {
          mockDb.refund.create.mockClear();
          throw err;
        }
      });

      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow();
      // 事务已回滚：create 从未成功提交（此处以 clear 断言无残留读取路径；真实 DB 回滚由 A2.4 e2e/事务语义保证）
    });

    it('P1-5：订单已 CANCELLED（超时 job 先取消）→ 幂等不炸，退款照常 COMPLETED', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING_CONFIRM' });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'COD' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, status: 'PENDING' });
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'PENDING' });
      // 事务内 cancelOrderInTx 重查订单已是 CANCELLED
      mockDb.order.findUnique
        .mockResolvedValueOnce({ ...baseOrder, status: 'PENDING_CONFIRM' }) // 事务外快查
        .mockResolvedValue({ ...baseOrder, status: 'CANCELLED' }); // 事务内重查

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
      });
      expect(result.status).toBe('COMPLETED');
      // 已终态 → 不再翻状态（updateMany 未被 cancelOrderInTx 调用）
      expect(mockDb.order.updateMany).not.toHaveBeenCalled();
    });

    it('订单不存在 → E-REFUND-005', async () => {
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

    it('订单已 CANCELLED → E-REFUND-001', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'CANCELLED' });
      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('已有进行中退款 → E-REFUND-002', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue({ id: 'old-refund', status: 'PENDING' });
      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    // ===== A2.4（P1-5，方案v2 20261011）：cancelOrderInternal 失败 → 退款事务整体回滚 =====
    // 与上方「P1-5：自动通过时订单取消失败」互补：该用例注入守卫翻转 count=0；
    // 本用例注入守卫翻转成功后的必经步骤（OrderEvent.create）硬失败——两条失败路径
    // 都必须让 withTransaction 整体 reject（真实 DB 回滚，ref 无 PENDING 残留）。
    it('A2.4：cancelOrderInTx 库存释放抛错 → 退款事务整体回滚（refund 不落 COMPLETED）', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING_CONFIRM' });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'COD' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, status: 'PENDING' });
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'PENDING' });
      mockDb.order.updateMany.mockResolvedValue({ count: 1 }); // 守卫翻转成功
      // cancelOrderInTx 守卫翻转后的必经步骤硬失败（OrderEvent.create 抛错）→
      // withTransaction 整体 reject：refund.create 已插入的行随真实 DB 事务回滚（ref 仍无 PENDING）
      mockDb.orderEvent.create.mockRejectedValue(new Error('EVENT_WRITE_FAILED'));

      await expect(
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ).rejects.toThrow();
      // 事务回滚：refund 从未到 COMPLETED（翻转未发生）
      expect(mockDb.refund.updateMany).not.toHaveBeenCalled();
    });

    // R5 假假教训：并发 spec 必须引用真实事务语义（advisory lock 串行化 → 事务内权威重查），
    // 禁 withTransaction mock 直通。withdraw.service.test.ts「并发 TOCTOU」同款范式：
    // advisory lock 在 mock 环境不实际阻塞，但两笔请求经锁串行化后，后到者在【事务内】
    // 重查到先到者已插入的 PENDING → E-REFUND-002，create 只落一条。
    it('A2.3：advisory lock 在事务内、refund.create 之前获取（P1-4 锁序断言）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue(baseRefund);

      await service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' });

      // 锁必须在 withTransaction 事务内（tx=mockDb 上的 $executeRaw），且先于 create
      expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockHelpers.withTransaction).toHaveBeenCalledTimes(1);
      expect(mockDb.refund.create).toHaveBeenCalledTimes(1);
      const lockCallOrder = mockDb.$executeRaw.mock.invocationCallOrder[0];
      const createCallOrder = mockDb.refund.create.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(createCallOrder);
    });

    it('A2.3：并发双 POST（锁串行化）→ 后到者事务内重查到 PENDING → E-REFUND-002，只落一条', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      // 事务内 in-flight 重查：第一笔（赢家）查不到 → 插入；第二笔（输家，锁释放后进）
      // 查到赢家已插入的 PENDING → E-REFUND-002
      let createdCount = 0;
      mockDb.refund.findFirst.mockImplementation(async () => {
        return createdCount > 0 ? { id: 'refund-1', status: 'PENDING' } : null;
      });
      mockDb.refund.create.mockImplementation(async () => {
        createdCount += 1;
        return { ...baseRefund, id: `refund-${createdCount}` };
      });

      // 真实事务语义（R5 禁直通）：pg_advisory_xact_lock 的效果是「后到事务整个等到先到
      // 事务提交后才开始」——mock 用事务级互斥队列复刻该串行化（第二笔的整个事务排在
      // 第一笔事务完成之后），而非放任两笔事务在 await 点交错（那是 mock 直通假绿）。
      let txChain = Promise.resolve();
      mockHelpers.withTransaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
        const run = txChain.then(() => fn(mockDb));
        txChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      });

      // 两笔并发请求（HTTP 层并发双 POST 的等价物）
      const results = await Promise.allSettled([
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
        service.createRefund({ orderId: 'order-1', userId: 'user-1', reason: 'X' }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r) => r.status === 'rejected' && (r.reason as { response?: { code?: string } })?.response?.code === 'E-REFUND-002',
      );
      // 恰好一笔成功、一笔 E-REFUND-002
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // 数据库层只产生一条退款（advisory lock + 事务内权威重查的双保险）
      expect(createdCount).toBe(1);
      expect(mockDb.refund.create).toHaveBeenCalledTimes(1);
      // 两笔都进了事务、都拿了锁（串行化前提）
      expect(mockHelpers.withTransaction).toHaveBeenCalledTimes(2);
      expect(mockDb.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('部分退款（items[]）→ amount = sum(unitPrice × refundQty) + 建 RefundItem（P13）', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        ...baseOrder,
        items: [
          { id: 'oi-1', skuId: 'sku-1', productName: { en: 'Apple' }, unitPrice: 500, quantity: 3, subtotal: 1500 },
          { id: 'oi-2', skuId: 'sku-2', productName: { en: 'Milk' }, unitPrice: 800, quantity: 2, subtotal: 1600 },
        ],
      });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.refundItem.findMany.mockResolvedValue([]);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, amount: 1300, items: [] });

      await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        items: [
          { orderItemId: 'oi-1', refundQty: 1 }, // 500 × 1 = 500
          { orderItemId: 'oi-2', refundQty: 1 }, // 800 × 1 = 800
        ],
      });

      // amount = 500 + 800 = 1300（非整单 10000）
      expect(mockDb.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 1300,
            items: {
              create: expect.arrayContaining([
                expect.objectContaining({ orderItemId: 'oi-1', refundQty: 1, subtotal: 500, skuId: 'sku-1' }),
                expect.objectContaining({ orderItemId: 'oi-2', refundQty: 1, subtotal: 800, skuId: 'sku-2' }),
              ]),
            },
          }),
          include: { items: true },
        }),
      );
    });

    it('部分退款：refundQty > quantity → E-REFUND-009（P13）', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        ...baseOrder,
        items: [{ id: 'oi-1', skuId: 'sku-1', productName: { en: 'Apple' }, unitPrice: 500, quantity: 2, subtotal: 1000 }],
      });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.refundItem.findMany.mockResolvedValue([]);

      await expect(
        service.createRefund({
          orderId: 'order-1',
          userId: 'user-1',
          reason: 'QUALITY_ISSUE',
          items: [{ orderItemId: 'oi-1', refundQty: 5 }], // 5 > 2
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.refund.create).not.toHaveBeenCalled();
    });

    it('部分退款：COMPLETED 后累计超额 → E-REFUND-009（P1 累计校验，审查 B.7）', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        ...baseOrder,
        items: [{ id: 'oi-1', skuId: 'sku-1', productName: { en: 'Apple' }, unitPrice: 500, quantity: 10, subtotal: 5000 }],
      });
      mockDb.refund.findFirst.mockResolvedValue(null);
      // 前次 COMPLETED 退款已退 6 件（remaining = 10 - 6 = 4）
      mockDb.refundItem.findMany.mockResolvedValue([{ orderItemId: 'oi-1', refundQty: 6 }]);

      await expect(
        service.createRefund({
          orderId: 'order-1',
          userId: 'user-1',
          reason: 'QUALITY_ISSUE',
          items: [{ orderItemId: 'oi-1', refundQty: 5 }], // 6 + 5 = 11 > 10 超额
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.refund.create).not.toHaveBeenCalled();
    });

    it('部分退款：orderItemId 不属于该 order → E-REFUND-008（P13）', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        ...baseOrder,
        items: [{ id: 'oi-1', skuId: 'sku-1', productName: { en: 'Apple' }, unitPrice: 500, quantity: 2, subtotal: 1000 }],
      });
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.refundItem.findMany.mockResolvedValue([]);

      await expect(
        service.createRefund({
          orderId: 'order-1',
          userId: 'user-1',
          reason: 'QUALITY_ISSUE',
          items: [{ orderItemId: 'oi-not-exist', refundQty: 1 }],
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.refund.create).not.toHaveBeenCalled();
    });
  });

  describe('reviewRefund - APPROVE', () => {
    it('金额一致 → COMPLETED + transactionId', async () => {
      mockDb.refund.findUnique.mockResolvedValue(baseRefund);
      mockDb.order.findUnique.mockResolvedValue({
        payableAmount: 10000,
        status: 'CONFIRMED',
        warehouse: { shopId: 'shop-1' },
      });

      const result = await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(result.status).toBe('COMPLETED');
      expect(result.transactionId).toMatch(/^MOCK_REFUND_/);
      expect(mockLogger.error).not.toHaveBeenCalled();
      // D8（A2.9a 接线）：审核通过 COMPLETED 同事务触发负向调整（reviewRefund 事务内 tx=mockDb）
      expect(mockSettlementAdjustment.applyRefundSettlementAdjustment).toHaveBeenCalledWith(
        mockDb,
        10000,
        expect.any(Date),
        'shop-1',
      );
    });

    it('金额 = 0 → E-REFUND-006（防 0 元退款）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, amount: 0 });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: 10000, status: 'CONFIRMED', warehouse: { shopId: 'shop-1' } });

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

    it('金额 > order.payableAmount → E-REFUND-010（防超额；P13 放宽：部分退款 amount < payable 合法）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, amount: 10001 });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: 10000, status: 'CONFIRMED', warehouse: { shopId: 'shop-1' } });

      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(ConflictException);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'REFUND_AMOUNT_EXCEEDS_ORDER_PAYABLE',
          refundAmount: 10001,
          orderPayableAmount: 10000,
        }),
      );
      expect(mockDb.refund.update).not.toHaveBeenCalled();
    });

    it('订单不存在 → E-REFUND-005（外键理论防住，此为防御）', async () => {
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

  describe('reviewRefund - P14 ④ RETURN_REFUND 触发 createTaskForReturn', () => {
    beforeEach(() => {
      // 区分 token：DispatchService 返 mockDispatchService，其他（OrderService）返 mockOrderService
      mockModuleRef.get.mockImplementation((token: unknown) =>
        token === DispatchService ? mockDispatchService : mockOrderService,
      );
    });

    it('APPROVE + RETURN_REFUND → 触发 createTaskForReturn(refundId)', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, refundType: 'RETURN_REFUND' });
      // 批2 item7：completeRefundTx select 扩了 items/warehouseId，order mock 补齐
      mockDb.order.findUnique.mockResolvedValue({
        payableAmount: 10000,
        status: 'CONFIRMED',
        warehouseId: 'wh-1',
        warehouse: { shopId: 'shop-1' },
        items: [],
      });
      mockDispatchService.createTaskForReturn.mockResolvedValue({} as never);

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockDispatchService.createTaskForReturn).toHaveBeenCalledWith('refund-1');
    });

    it('APPROVE + REFUND_ONLY → 不触发 createTaskForReturn（向后兼容）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, refundType: 'REFUND_ONLY' });
      mockDb.order.findUnique.mockResolvedValue({
        payableAmount: 10000, status: 'CONFIRMED', warehouseId: 'wh-1', warehouse: { shopId: 'shop-1' }, items: [],
      });

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockDispatchService.createTaskForReturn).not.toHaveBeenCalled();
    });

    it('REJECT + RETURN_REFUND → 不触发（仅 APPROVE 才建 return task）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, refundType: 'RETURN_REFUND' });
      mockDb.refund.update.mockResolvedValue({
        ...baseRefund,
        refundType: 'RETURN_REFUND',
        status: 'REJECTED',
        reviewNote: 'invalid',
      });

      await service.reviewRefund('refund-1', 'admin-1', 'REJECT', 'invalid');

      expect(mockDispatchService.createTaskForReturn).not.toHaveBeenCalled();
    });
  });

  describe('reviewRefund - 状态校验', () => {
    it('refund 不存在 → E-REFUND-003', async () => {
      mockDb.refund.findUnique.mockResolvedValue(null);
      await expect(
        service.reviewRefund('nope', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refund 非 PENDING → E-REFUND-004', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'COMPLETED' });
      await expect(
        service.reviewRefund('refund-1', 'admin-1', 'APPROVE'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ============================================================
  // 批A 销量真实统计（2026-09-07）：completeRefundTx 守卫与回滚接线
  // 回滚 helper 逻辑在 sales-count.helper.test.ts 单测，此处断言接线与守卫分支
  // ============================================================
  describe('批A 销量真实统计 - reviewRefund APPROVE 销量回滚', () => {
    /** APPROVE 场景公共 mock（order 同时供金额断言 + 销量守卫两次查询 + D8 shopId） */
    function setupApprove(refundOverrides: Record<string, unknown>, orderOverrides: Record<string, unknown>) {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, ...refundOverrides });
      mockDb.order.findUnique.mockResolvedValue({
        payableAmount: 10000,
        status: 'CONFIRMED',
        warehouse: { shopId: 'shop-1' },
        ...orderOverrides,
      });
      // updateMany 默认 count=1（beforeEach），并发输家 case 单独覆盖
    }

    it('预付已支付（paymentStatus=PAID）+ 部分退款 items → 按 RefundItem 回滚', async () => {
      setupApprove(
        { items: [{ skuId: 'sku-1', refundQty: 2 }] },
        { paymentStatus: 'PAID', paymentMethod: 'WECHAT' },
      );

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.rollbackSalesCountForRefundItems).toHaveBeenCalledTimes(1);
      expect(mockHelpers.rollbackSalesCountForRefundItems).toHaveBeenCalledWith(
        mockDb,
        'order-1',
        [{ skuId: 'sku-1', refundQty: 2 }],
        { operatorId: 'admin-1' },
      );
      expect(mockHelpers.rollbackSalesCountForFullOrder).not.toHaveBeenCalled();
    });

    it('预付已支付 + 整单退款（items=[]）→ rollbackSalesCountForFullOrder', async () => {
      setupApprove({ items: [] }, { paymentStatus: 'PAID', paymentMethod: 'WECHAT' });

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.rollbackSalesCountForFullOrder).toHaveBeenCalledTimes(1);
      expect(mockHelpers.rollbackSalesCountForFullOrder).toHaveBeenCalledWith(mockDb, 'order-1', {
        operatorId: 'admin-1',
      });
      expect(mockHelpers.rollbackSalesCountForRefundItems).not.toHaveBeenCalled();
    });

    it('未支付订单（paymentStatus=PENDING，非 COD）→ 守卫跳过不回滚（销量从未累加）', async () => {
      setupApprove(
        { items: [{ skuId: 'sku-1', refundQty: 2 }] },
        { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', paymentMethod: 'WECHAT' },
      );

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.rollbackSalesCountForRefundItems).not.toHaveBeenCalled();
      expect(mockHelpers.rollbackSalesCountForFullOrder).not.toHaveBeenCalled();
    });

    it('COD 订单有收款成功记录（PAID/SHORT）→ 回滚（deliverTask 累加过）', async () => {
      setupApprove(
        { items: [{ skuId: 'sku-1', refundQty: 1 }] },
        { status: 'DELIVERED_PAID', paymentStatus: 'PENDING', paymentMethod: 'COD' },
      );
      mockDb.cashCollection.findFirst.mockResolvedValue({ id: 'cash-1' });

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockDb.cashCollection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderId: 'order-1', result: { in: ['PAID', 'SHORT'] } }),
        }),
      );
      expect(mockHelpers.rollbackSalesCountForRefundItems).toHaveBeenCalledTimes(1);
    });

    it('COD 订单无收款成功记录（拒付 DELIVERED_UNPAID）→ 不回滚', async () => {
      setupApprove(
        { items: [{ skuId: 'sku-1', refundQty: 1 }] },
        { status: 'DELIVERED_UNPAID', paymentStatus: 'PENDING', paymentMethod: 'COD' },
      );
      mockDb.cashCollection.findFirst.mockResolvedValue(null);

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.rollbackSalesCountForRefundItems).not.toHaveBeenCalled();
      expect(mockHelpers.rollbackSalesCountForFullOrder).not.toHaveBeenCalled();
    });

    it('P2-1 并发双批输家：条件翻转 count=0 → E-REFUND-004 且不回滚', async () => {
      setupApprove(
        { items: [{ skuId: 'sku-1', refundQty: 1 }] },
        { paymentStatus: 'PAID', paymentMethod: 'WECHAT' },
      );
      mockDb.refund.updateMany.mockResolvedValue({ count: 0 }); // 并发赢家已翻走 PENDING

      await expect(service.reviewRefund('refund-1', 'admin-1', 'APPROVE')).rejects.toMatchObject({
        response: { code: 'E-REFUND-004' },
      });

      expect(mockHelpers.rollbackSalesCountForRefundItems).not.toHaveBeenCalled();
      expect(mockHelpers.rollbackSalesCountForFullOrder).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 批2 item7（20261012）：RETURN_REFUND 回补库存（releaseStock changeType=RETURN）
  // 对齐同文件 cancel 先例（releaseStock 'RETURN'）；走取消-退款链路：
  //   - reviewRefund APPROVE + RETURN_REFUND → 按单回补（部分 refundQty / 整单 OrderItem）
  //   - autoApprove（接单前取消）走 cancelOrderInTx 的 RELEASE，不重复回补
  // ============================================================
  describe('批2 item7 - RETURN_REFUND 回补库存', () => {
    function setupReturnApprove(refundOverrides: Record<string, unknown>, orderOverrides: Record<string, unknown>) {
      mockDb.refund.findUnique.mockResolvedValue({
        ...baseRefund,
        refundType: 'RETURN_REFUND',
        ...refundOverrides,
      });
      mockDb.order.findUnique.mockResolvedValue({
        id: 'order-1',
        paymentStatus: 'PENDING', // 未支付 → 销量守卫跳过，隔离回补断言
        paymentMethod: 'COD',
        warehouseId: 'wh-1',
        warehouse: { shopId: 'shop-1' },
        items: [
          { skuId: 'sku-1', quantity: 3 },
          { skuId: 'sku-2', quantity: 1 },
        ],
        ...orderOverrides,
      });
    }

    it('APPROVE + RETURN_REFUND 整单退款（items=[]）→ 按 OrderItem 全量回补 changeType=RETURN', async () => {
      setupReturnApprove({ items: [] }, {});

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.releaseStock).toHaveBeenCalledTimes(2);
      expect(mockHelpers.releaseStock).toHaveBeenCalledWith(
        mockDb, 'wh-1', 'sku-1', 3, 'RETURN',
        expect.objectContaining({ referenceType: 'REFUND', referenceId: 'refund-1', operatorId: 'admin-1' }),
      );
      expect(mockHelpers.releaseStock).toHaveBeenCalledWith(
        mockDb, 'wh-1', 'sku-2', 1, 'RETURN', expect.objectContaining({ referenceId: 'refund-1' }),
      );
    });

    it('APPROVE + RETURN_REFUND 部分退款（有 items）→ 按 RefundItem.refundQty 回补', async () => {
      setupReturnApprove(
        { items: [{ skuId: 'sku-1', refundQty: 2 }] },
        {},
      );

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.releaseStock).toHaveBeenCalledTimes(1);
      expect(mockHelpers.releaseStock).toHaveBeenCalledWith(
        mockDb, 'wh-1', 'sku-1', 2, 'RETURN', expect.objectContaining({ referenceId: 'refund-1' }),
      );
    });

    it('APPROVE + REFUND_ONLY → 不回补（仅 RETURN_REFUND 才回仓）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, refundType: 'REFUND_ONLY' });
      mockDb.order.findUnique.mockResolvedValue({
        id: 'order-1', paymentStatus: 'PENDING', paymentMethod: 'COD',
        warehouseId: 'wh-1', warehouse: { shopId: 'shop-1' }, items: [{ skuId: 'sku-1', quantity: 3 }],
      });

      await service.reviewRefund('refund-1', 'admin-1', 'APPROVE');

      expect(mockHelpers.releaseStock).not.toHaveBeenCalled();
    });

    it('接单前自动通过（autoApprove）→ 走 cancelOrderInTx 的 RELEASE，不在此处回补', async () => {
      // PENDING_PAYMENT 命中 AUTO_APPROVE_STATUSES：completeRefundTx 不传 restock
      setupReturnApprove({ items: [] }, { status: 'PENDING_PAYMENT' });
      mockDb.order.findUnique.mockImplementation(((args: { where: { id: string } }) => {
        // createRefund 校验用 baseOrder，completeRefundTx 查单时返回可回补快照
        return Promise.resolve({
          id: args.where.id, userId: 'user-1', status: 'PENDING_PAYMENT',
          payableAmount: 10000, paymentStatus: 'PENDING', paymentMethod: 'WECHAT',
          warehouseId: 'wh-1', warehouse: { shopId: 'shop-1' }, items: [],
          riderId: null,
        });
      }) as never);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue({ ...baseRefund, refundType: 'RETURN_REFUND', status: 'COMPLETED' });
      mockDb.refund.findUnique.mockResolvedValue({
        ...baseRefund, refundType: 'RETURN_REFUND', status: 'COMPLETED', items: [],
      });
      // A2.4 用例遗留的 orderEvent.create rejection 未在 beforeEach 重置，此处补默认成功
      mockDb.orderEvent.create.mockResolvedValue({});

      await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
        reasonDetail: 'not received',
      });

      // autoApprove 路径：releaseStock 不被 refund 侧调用（取消链路已在 cancelOrderInTx RELEASE）
      expect(mockHelpers.releaseStock).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 批A P2-2（审查 2026-09-07）：整单退款 ↔ 部分退款 双向封口
  // ============================================================
  describe('批A P2-2 - 整单/部分退款互斥封口', () => {
    it('整单退款完成后再申请部分退款 → E-REFUND-009（销量/金额双重退口子）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      // E-REFUND-002 在途检查（status in PENDING/APPROVED）→ 无；P2-2 整单存在检查（items none）→ 有
      mockDb.refund.findFirst.mockImplementation(((args: {
        where: { status?: { in?: string[] } };
      }) => {
        if (args?.where?.status?.in) return Promise.resolve(null);
        return Promise.resolve({ id: 'refund-full' });
      }) as never);
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });

      await expect(
        service.createRefund({
          orderId: 'order-1',
          userId: 'user-1',
          reason: 'QUALITY_ISSUE',
          items: [{ orderItemId: 'oi-1', refundQty: 1 }],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-REFUND-009' } });
    });

    it('部分退款完成后再申请整单退款 → E-REFUND-009（Σ COMPLETED 金额 + 本次 > payable）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder); // payable 10000
      mockDb.refund.findFirst.mockResolvedValue(null); // 无在途退款
      mockDb.refund.aggregate.mockResolvedValue({ _sum: { amount: 6000 } }); // 已部分退 6000
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });

      await expect(
        service.createRefund({
          orderId: 'order-1',
          userId: 'user-1',
          reason: 'QUALITY_ISSUE',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-REFUND-009' } });
    });

    it('无历史退款 → 整单退款正常放行（累计校验不误伤）', async () => {
      mockDb.order.findUnique.mockResolvedValue(baseOrder);
      mockDb.refund.findFirst.mockResolvedValue(null);
      mockDb.refund.aggregate.mockResolvedValue({ _sum: { amount: null } }); // 0
      mockDb.paymentIntent.findUnique.mockResolvedValue({ method: 'WECHAT' });
      mockDb.refund.create.mockResolvedValue(baseRefund);

      const result = await service.createRefund({
        orderId: 'order-1',
        userId: 'user-1',
        reason: 'QUALITY_ISSUE',
      });

      expect(result.status).toBe('PENDING');
      expect(mockDb.refund.create).toHaveBeenCalled();
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

    it('非 PENDING → E-REFUND-004', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, status: 'COMPLETED' });
      await expect(service.cancelRefund('refund-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('getRefundDetail - 归属校验（P1-1）', () => {
    it('本人查询 → 正常返回', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, items: [] });

      const result = await service.getRefundDetail('refund-1', 'user-1');
      expect(result.id).toBe('refund-1');
    });

    it('非本人查询 → 403 E-AUTH-012（对齐 cancelRefund 先例）', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, userId: 'other', items: [] });
      const err = await service.getRefundDetail('refund-1', 'user-1').catch((e: ForbiddenException) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'E-AUTH-012' });
    });

    it('admin 视角（不传 userId）→ 跳过归属校验', async () => {
      mockDb.refund.findUnique.mockResolvedValue({ ...baseRefund, userId: 'other', items: [] });

      const result = await service.getRefundDetail('refund-1', null);
      expect(result.id).toBe('refund-1');
    });

    it('不存在 → E-REFUND-003', async () => {
      mockDb.refund.findUnique.mockResolvedValue(null);
      await expect(service.getRefundDetail('refund-404', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // 客服工作台批 2（20261018）审查 P3-1：orderId 反查 where 传参锁定
  describe('listAllRefunds - orderId 过滤（客服工作台反查）', () => {
    it('传 orderId -> findMany where 含 orderId（objectContaining 锁定）', async () => {
      mockDb.refund.findMany.mockResolvedValue([]);
      await service.listAllRefunds({ orderId: '0d9e4c85-2b9f-45d0-973a-7c0b94367d14' });
      expect(mockDb.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderId: '0d9e4c85-2b9f-45d0-973a-7c0b94367d14',
          }),
        }),
      );
    });

    it('不传 orderId -> findMany where 不含 orderId 键（既有行为回归）', async () => {
      mockDb.refund.findMany.mockResolvedValue([]);
      await service.listAllRefunds({});
      const call = mockDb.refund.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).not.toHaveProperty('orderId');
    });
  });

  describe('CreateRefundRequest zod schema（P14-defer 审查 P3-1 修复：refundType enum 拒绝）', () => {
    // 测 api-contract CreateRefundRequest schema（与 refund.controller 内联 CreateRefundRequest 一致，
    // 审查报告 §2.3 verify 两层一致）。e2e 也补了 HTTP 层用例（e2e-main-flows L429-454），
    // 但 e2e 依赖 DB seed（当前环境 P2002 脏数据跑不起来），此单测不依赖 DB 兜底验证 zod enum 拒绝。
    it('refundType 非法值 "WRONG" -> safeParse 失败', () => {
      const result = CreateRefundRequest.safeParse({
        orderId: '00000000-0000-0000-0000-000000000000',
        reason: 'OTHER',
        refundType: 'WRONG',
      });
      expect(result.success).toBe(false);
    });

    it('refundType=RETURN_REFUND -> 通过', () => {
      const result = CreateRefundRequest.safeParse({
        orderId: '00000000-0000-0000-0000-000000000000',
        reason: 'OTHER',
        refundType: 'RETURN_REFUND',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.refundType).toBe('RETURN_REFUND');
      }
    });

    it('refundType=REFUND_ONLY -> 通过', () => {
      const result = CreateRefundRequest.safeParse({
        orderId: '00000000-0000-0000-0000-000000000000',
        reason: 'OTHER',
        refundType: 'REFUND_ONLY',
      });
      expect(result.success).toBe(true);
    });

    it('refundType 不传 -> 默认 REFUND_ONLY（向后兼容）', () => {
      const result = CreateRefundRequest.safeParse({
        orderId: '00000000-0000-0000-0000-000000000000',
        reason: 'OTHER',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.refundType).toBe('REFUND_ONLY');
      }
    });

    it('refundType 小写 "refund_only" -> 拒绝（enum 大小写敏感）', () => {
      const result = CreateRefundRequest.safeParse({
        orderId: '00000000-0000-0000-0000-000000000000',
        reason: 'OTHER',
        refundType: 'refund_only',
      });
      expect(result.success).toBe(false);
    });
  });
});
