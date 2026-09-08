/**
 * OrderService.createOrder 单测（聚焦 W3-C 新增逻辑）
 *
 * 覆盖：
 *   - 地址不存在 → E-ORDER-001
 *   - 地址不属于当前用户 → E-ORDER-001
 *   - 地址缺 lat/lng → E-ORDER-001
 *   - 无仓库覆盖 → E-ORDER-001
 *   - SKU 无效 → E-ORDER-005
 *   - SKU 已下架 → E-ORDER-005
 *   - 库存不足（deductStock 返回 false） → E-ORDER-002
 *   - Happy path → 创建订单 + 入队 timeout job
 *
 * 注：W2-C P1-3 已覆盖 order-status.machine + order-no.service（61 测试），
 *     本文件聚焦 service 层 createOrder 流程 + W3-C 新接入的 timeout 入队
 *
 * mock：db + findWarehouseByPoint + withTransaction + deductStock + releaseStock
 *       + orderNoService + paymentService + timeout queue
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../src/prisma/client';

const { mockDb, mockHelpers, mockOrderNo, mockPayment, mockQueue, mockCart, mockPricing, mockSalesIncrement } = vi.hoisted(() => ({
  mockDb: {
    address: { findUnique: vi.fn() },
    // 批A 汇率快照（审查 P3-2）：WECHAT 下单 Step 5.5 查当日汇率
    exchangeRate: { findUnique: vi.fn() },
    sku: { findMany: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    orderItem: { findMany: vi.fn() },
    orderEvent: { create: vi.fn() },
  },
  mockHelpers: {
    findWarehouseByPoint: vi.fn(),
    withTransaction: vi.fn(),
    deductStock: vi.fn(),
    releaseStock: vi.fn(),
  },
  mockOrderNo: { nextOrderNo: vi.fn() },
  mockPayment: { createIntentForOrder: vi.fn() },
  mockQueue: { add: vi.fn(), getJob: vi.fn() },
  mockCart: { clearOrderedItems: vi.fn() },
  // 距离计费批次1（2026-08-27）：createOrder Step 4.5 调 pricingService.calcDeliveryFee
  mockPricing: { calcDeliveryFee: vi.fn() },
  // 批A 销量真实统计：markPaidTx 支付成功累加（helper 逻辑在 sales-count.helper.test.ts）
  mockSalesIncrement: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: mockHelpers.withTransaction,
  deductStock: mockHelpers.deductStock,
  releaseStock: mockHelpers.releaseStock,
  findWarehouseByPoint: mockHelpers.findWarehouseByPoint,
  incrementSalesCountForOrder: mockSalesIncrement,
}));

vi.mock('../src/modules/order/order-no.service', () => ({
  OrderNoService: class {
    nextOrderNo = mockOrderNo.nextOrderNo;
  },
}));

vi.mock('../src/modules/order/order-timeout.helper', () => ({
  enqueueOrderTimeout: vi.fn(async (_queue: unknown, orderId: string, _status: string) => {
    void _queue;
    void _status;
    return Promise.resolve({ orderId });
  }),
  cancelOrderTimeout: vi.fn(),
  ORDER_TIMEOUT_MS: 15 * 60 * 1000,
}));

vi.mock('bullmq', () => ({
  Queue: class {},
}));

import { OrderService } from '../src/modules/order/order.service';
vi.mock('../src/modules/pricing/pricing.service', () => ({
  PricingService: class {
    calcDeliveryFee = mockPricing.calcDeliveryFee;
  },
}));

/** 构造 mock order record（withTransaction 回调内的 tx.order.create 返回值） */
function mockCreatedOrder(overrides: Partial<{
  id: string; orderNo: string; status: string; warehouseId: string;
  totalAmount: number; deliveryFee: number; discountAmount: number; payableAmount: number;
  paymentMethod: string; paymentStatus: string;
}> = {}) {
  return {
    id: 'order-1',
    orderNo: 'MM20260625010000001',
    userId: 'user-1',
    warehouseId: 'wh-1',
    status: 'PENDING_CONFIRM',
    totalAmount: 200,
    deliveryFee: 0,
    discountAmount: 0,
    payableAmount: 200,
    paymentMethod: 'COD',
    paymentStatus: 'PENDING',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('OrderService.createOrder', () => {
  let service: OrderService;

  beforeEach(() => {
    Object.values(mockDb).forEach((table) => {
      Object.values(table).forEach((fn) => fn.mockReset());
    });
    Object.values(mockHelpers).forEach((fn) => fn.mockReset());
    mockOrderNo.nextOrderNo.mockReset();
    mockPayment.createIntentForOrder.mockReset();
    mockQueue.add.mockReset();
    mockCart.clearOrderedItems.mockReset();
    mockPricing.calcDeliveryFee.mockReset();
    // 默认 calcDeliveryFee（覆盖 happy/P1/B1；提前抛错的 case 不会走到计费，mock 设不设无影响）
    mockPricing.calcDeliveryFee.mockResolvedValue({
      warehouseId: 'wh-1',
      baseFee: 0,
      perKmFee: 0,
      freeKm: 2,
      distanceKm: 1.2,
      distanceFee: 0,
      deliveryFee: 0,
      currency: 'USD',
    });

    // 默认空 items 列表（createOrder 末尾查 OrderItem 用，可被具体 case 覆盖）
    mockDb.orderItem.findMany.mockResolvedValue([]);

    service = new OrderService(
      new (class { nextOrderNo = mockOrderNo.nextOrderNo })(),
      mockPayment,
      mockQueue,
      null, // dispatchService（happy path 中 markPaid 才用，createOrder 不调）
      mockCart, // cartService（B1：createOrder 后调 clearOrderedItems）
      {} as never, // promotionService（happy path 不用 coupon，P1 case 单独注入）
      new (class {
        calcDeliveryFee = mockPricing.calcDeliveryFee;
      })(), // pricingService（距离计费批次1：mock calcDeliveryFee）
      null, // realtime
      null, // notifyFactory
    );
  });

  it('地址不存在 → 抛 E-ORDER-001', async () => {
    mockDb.address.findUnique.mockResolvedValue(null);

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'addr-x',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/Delivery address not found/);
  });

  it('地址不属于当前用户 → 抛 E-ORDER-001', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'other-user',
      lat: -8.5,
      lng: 125.5,
    });

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/Delivery address not found/);
  });

  it('地址缺 lat/lng → 抛 E-ORDER-001', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      lat: null,
      lng: null,
    });

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/missing lat\/lng/);
  });

  it('无仓库覆盖（PostGIS 未匹配） → 抛 E-ORDER-001', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue(null);

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/out of all warehouses coverage/);
  });

  it('SKU 部分无效 → 抛 E-ORDER-005', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({
      id: 'wh-1',
      code: 'W01',
      deliveryFee: 0,
    });
    mockDb.sku.findMany.mockResolvedValue([]); // 一个都没找到

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-x', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/SKUs are invalid or inactive/);
  });

  it('product 已下架 → 抛 E-ORDER-005', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      { id: 'sku-1', price: 100, status: 'ACTIVE', product: { status: 'INACTIVE' } },
    ]);

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/products are inactive/);
  });

  it('库存不足（deductStock 返回 false） → 抛 E-ORDER-002', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      name: 'Alice',
      phone: '+670123',
      detail: 'Home',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      {
        id: 'sku-1',
        price: 100,
        status: 'ACTIVE',
        productId: 'p-1',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'Milk' }, mainImage: 'img', status: 'ACTIVE' },
      },
    ]);
    mockOrderNo.nextOrderNo.mockResolvedValue('MM20260625010000001');

    // withTransaction 回调内 deductStock 失败 → throw STOCK_NOT_ENOUGH
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { create: vi.fn().mockResolvedValue(mockCreatedOrder()) },
        orderItem: { createMany: vi.fn().mockResolvedValue({}) },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      try {
        return await fn(tx);
      } catch (e) {
        throw e;
      }
    });
    mockHelpers.deductStock.mockResolvedValue(false);

    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 100 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.toThrow(/out of stock|STOCK_NOT_ENOUGH/);
  });

  it('Happy path → 创建订单 + 入队 timeout job', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      name: 'Alice',
      phone: '+670123',
      detail: 'Home',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      {
        id: 'sku-1',
        price: 100,
        status: 'ACTIVE',
        productId: 'p-1',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'Milk' }, mainImage: 'img', status: 'ACTIVE' },
      },
    ]);
    mockOrderNo.nextOrderNo.mockResolvedValue('MM20260625010000001');
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { create: vi.fn().mockResolvedValue(mockCreatedOrder()) },
        orderItem: { createMany: vi.fn().mockResolvedValue({}) },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    mockHelpers.deductStock.mockResolvedValue(true);
    // 距离计费批次1：mock calcDeliveryFee（happy path 配送费 0，与原 mockWarehouse deliveryFee=0 一致）
    mockPricing.calcDeliveryFee.mockResolvedValue({
      warehouseId: 'wh-1',
      baseFee: 0,
      perKmFee: 0,
      freeKm: 2,
      distanceKm: 1.2,
      distanceFee: 0,
      deliveryFee: 0,
      currency: 'USD',
    });
    mockPayment.createIntentForOrder.mockResolvedValue({
      intentId: 'pi-1',
      status: 'PENDING',
      clientSecret: undefined,
      mockFlag: false,
    });
    // 查 OrderItem 返回完整记录（与 DB 写入一致）
    mockDb.orderItem.findMany.mockResolvedValue([
      {
        id: 'oi-1',
        productId: 'p-1',
        skuId: 'sku-1',
        productName: { en: 'Milk' },
        productImage: 'img',
        skuName: { en: '1L' },
        unitPrice: 100,
        quantity: 2,
        subtotal: 200,
      },
    ]);

    const result = await service.createOrder({
      userId: 'user-1',
      addressId: 'a1',
      items: [{ skuId: 'sku-1', quantity: 2 }],
      paymentMethod: 'COD',
      deviceType: 'client_app',
    });

    expect(result.id).toBe('order-1');
    expect(result.orderNo).toBe('MM20260625010000001');
    expect(result.payableAmount).toBe(200);
    // P0-1 修复：items 字段返回完整快照
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'oi-1',
      productId: 'p-1',
      skuId: 'sku-1',
      unitPrice: 100,
      quantity: 2,
      subtotal: 200,
    });
    expect(result.createdAt).toBe('2026-06-25T00:00:00.000Z');

    // enqueueOrderTimeout 被调用（mock 模块捕获）
    const { enqueueOrderTimeout } = await import('../src/modules/order/order-timeout.helper');
    expect(enqueueOrderTimeout).toHaveBeenCalled();

    // B1 修复验证：cartService.clearOrderedItems 被调用，skuIds 来自 input.items
    expect(mockCart.clearOrderedItems).toHaveBeenCalledWith('user-1', ['sku-1']);
  });

  it('P1 领券体系: 传 couponId -> applyCoupon + 回填 UserCoupon.orderId + 写 OrderPromotion 关联', async () => {
    // 注入 promotionService mock（applyCoupon 替代 applyPromotion）
    const mockApplyCoupon = vi.fn().mockResolvedValue({
      userCouponId: 'uc-1',
      promotionId: 'promo-1',
      code: 'SAVE10',
      type: 'PERCENTAGE',
      discountAmount: 20,
    });
    (service as { promotionService: unknown }).promotionService = {
      applyCoupon: mockApplyCoupon,
    };
    // 距离计费批次1：P1 场景也走 calcDeliveryFee（deliveryFee=0，applyCoupon 传 0 与原断言一致）
    mockPricing.calcDeliveryFee.mockResolvedValue({
      warehouseId: 'wh-1',
      baseFee: 0,
      perKmFee: 0,
      freeKm: 2,
      distanceKm: 1.2,
      distanceFee: 0,
      deliveryFee: 0,
      currency: 'USD',
    });

    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      name: 'Alice',
      phone: '+670123',
      detail: 'Home',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      {
        id: 'sku-1',
        price: 100,
        status: 'ACTIVE',
        productId: 'p-1',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'Milk' }, mainImage: 'img', status: 'ACTIVE' },
      },
    ]);
    mockOrderNo.nextOrderNo.mockResolvedValue('MM20260625010000001');
    const txOrderPromotionCreate = vi.fn().mockResolvedValue({});
    const txUserCouponUpdate = vi.fn().mockResolvedValue({});
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { create: vi.fn().mockResolvedValue(mockCreatedOrder()) },
        orderItem: { createMany: vi.fn().mockResolvedValue({}) },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
        orderPromotion: { create: txOrderPromotionCreate },
        userCoupon: { update: txUserCouponUpdate },
      };
      return fn(tx);
    });
    mockHelpers.deductStock.mockResolvedValue(true);
    mockPayment.createIntentForOrder.mockResolvedValue({
      intentId: 'pi-1',
      status: 'PENDING',
      clientSecret: undefined,
      mockFlag: false,
    });
    mockDb.orderItem.findMany.mockResolvedValue([
      {
        id: 'oi-1',
        productId: 'p-1',
        skuId: 'sku-1',
        productName: { en: 'Milk' },
        productImage: 'img',
        skuName: { en: '1L' },
        unitPrice: 100,
        quantity: 2,
        subtotal: 200,
      },
    ]);

    const result = await service.createOrder({
      userId: 'user-1',
      addressId: 'a1',
      items: [{ skuId: 'sku-1', quantity: 2 }],
      paymentMethod: 'COD',
      deviceType: 'client_app',
      couponId: 'uc-1',
    });

    // applyCoupon 被调，传 couponId + userId + itemsSubtotal(200) + deliveryFee(0) + tx
    expect(mockApplyCoupon).toHaveBeenCalledWith(
      'uc-1',
      'user-1',
      200,
      0,
      expect.objectContaining({ order: expect.any(Object) }),
    );
    // UserCoupon.orderId 回填为新建订单 id
    expect(txUserCouponUpdate).toHaveBeenCalledWith({
      where: { id: 'uc-1' },
      data: { orderId: 'order-1' },
    });
    // OrderPromotion 关联写入（含 userCouponId）
    expect(txOrderPromotionCreate).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        promotionId: 'promo-1',
        code: 'SAVE10',
        discountAmount: 20,
        userCouponId: 'uc-1',
      },
    });
    expect(result.id).toBe('order-1');
  });


  it('B1 修复：cartService 抛错时 → 仅 warn，不阻塞下单', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      name: 'Alice',
      phone: '+670123',
      detail: 'Home',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      {
        id: 'sku-1',
        price: 100,
        status: 'ACTIVE',
        productId: 'p-1',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'Milk' }, mainImage: 'img', status: 'ACTIVE' },
      },
    ]);
    mockOrderNo.nextOrderNo.mockResolvedValue('MM20260625010000001');
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { create: vi.fn().mockResolvedValue(mockCreatedOrder()) },
        orderItem: { createMany: vi.fn().mockResolvedValue({}) },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    mockHelpers.deductStock.mockResolvedValue(true);
    // 距离计费批次1：B1 容错场景也走 calcDeliveryFee（deliveryFee=0）
    mockPricing.calcDeliveryFee.mockResolvedValue({
      warehouseId: 'wh-1',
      baseFee: 0,
      perKmFee: 0,
      freeKm: 2,
      distanceKm: 1.2,
      distanceFee: 0,
      deliveryFee: 0,
      currency: 'USD',
    });
    mockPayment.createIntentForOrder.mockResolvedValue({
      intentId: 'pi-1',
      status: 'PENDING',
      clientSecret: undefined,
      mockFlag: false,
    });
    mockCart.clearOrderedItems.mockRejectedValue(new Error('redis down'));

    // 不抛错（容错）
    const result = await service.createOrder({
      userId: 'user-1',
      addressId: 'a1',
      items: [{ skuId: 'sku-1', quantity: 1 }],
      paymentMethod: 'COD',
      deviceType: 'client_app',
    });

    expect(result.id).toBe('order-1');
    expect(mockCart.clearOrderedItems).toHaveBeenCalled();
  });

  // ===== 批A 汇率快照接线（审查 P3-2）：Step 5.5 → order.create data 回归 =====

  it('批A 汇率快照：WECHAT 下单 → 查当日汇率 1 次，order.create data 含 exchangeRate/estimatedCnyAmount', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      name: 'Alice',
      phone: '+670123',
      detail: 'Home',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      {
        id: 'sku-1',
        price: 100,
        status: 'ACTIVE',
        productId: 'p-1',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'Milk' }, mainImage: 'img', status: 'ACTIVE' },
      },
    ]);
    mockOrderNo.nextOrderNo.mockResolvedValue('MM20260908010000001');
    // 人民币通道（WECHAT）Step 5.5 查当日汇率：OPERATOR 行，万分位 72345 = 7.2345
    mockDb.exchangeRate.findUnique.mockResolvedValue({
      id: 'rate-1',
      rateDate: new Date('2026-09-08T00:00:00.000Z'),
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      rate: 72345,
      source: 'OPERATOR',
      operatorId: 'admin-1',
      createdAt: new Date('2026-09-08T01:00:00.000Z'),
    });
    const txOrderCreate = vi
      .fn()
      .mockResolvedValue(mockCreatedOrder({ paymentMethod: 'WECHAT', status: 'PENDING_PAYMENT' }));
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { create: txOrderCreate },
        orderItem: { createMany: vi.fn().mockResolvedValue({}) },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    mockHelpers.deductStock.mockResolvedValue(true);
    mockPayment.createIntentForOrder.mockResolvedValue({
      intentId: 'pi-1',
      status: 'PENDING',
      clientSecret: undefined,
      mockFlag: false,
    });

    await service.createOrder({
      userId: 'user-1',
      addressId: 'a1',
      items: [{ skuId: 'sku-1', quantity: 2 }],
      paymentMethod: 'WECHAT',
      deviceType: 'client_app',
    });

    // Step 5.5 查当日汇率恰 1 次（CNY_PAYMENT_METHODS 命中）
    expect(mockDb.exchangeRate.findUnique).toHaveBeenCalledTimes(1);
    // payable 200 分 × 72345 / 10000 = 1446.9 → 1447 分，快照锁进 order.create data
    expect(txOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ exchangeRate: 72345, estimatedCnyAmount: 1447 }),
      }),
    );
  });

  it('批A 汇率快照：COD 下单 → 不查库，order.create data 汇率双字段 null（非人民币零影响回归）', async () => {
    mockDb.address.findUnique.mockResolvedValue({
      id: 'a1',
      userId: 'user-1',
      name: 'Alice',
      phone: '+670123',
      detail: 'Home',
      lat: -8.5,
      lng: 125.5,
    });
    mockHelpers.findWarehouseByPoint.mockResolvedValue({ id: 'wh-1', code: 'W01', deliveryFee: 0 });
    mockDb.sku.findMany.mockResolvedValue([
      {
        id: 'sku-1',
        price: 100,
        status: 'ACTIVE',
        productId: 'p-1',
        name: { en: '1L' },
        product: { id: 'p-1', name: { en: 'Milk' }, mainImage: 'img', status: 'ACTIVE' },
      },
    ]);
    mockOrderNo.nextOrderNo.mockResolvedValue('MM20260908010000001');
    const txOrderCreate = vi.fn().mockResolvedValue(mockCreatedOrder());
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { create: txOrderCreate },
        orderItem: { createMany: vi.fn().mockResolvedValue({}) },
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    mockHelpers.deductStock.mockResolvedValue(true);
    mockPayment.createIntentForOrder.mockResolvedValue({
      intentId: 'pi-1',
      status: 'PENDING',
      clientSecret: undefined,
      mockFlag: false,
    });

    await service.createOrder({
      userId: 'user-1',
      addressId: 'a1',
      items: [{ skuId: 'sku-1', quantity: 2 }],
      paymentMethod: 'COD',
      deviceType: 'client_app',
    });

    // 非人民币通道：Step 5.5 返回 null 且不查库
    expect(mockDb.exchangeRate.findUnique).not.toHaveBeenCalled();
    expect(txOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ exchangeRate: null, estimatedCnyAmount: null }),
      }),
    );
  });

  // ===== 批B 支付枚举补位（微信支付预留 2026-09-08，方案V2 §3.2）：R2 下单可用性校验 =====

  it('批B R2：下单拒绝占位渠道 WECHAT_GLOBAL（available=false）→ 400 E-PAYMENT-011，且先于任何 DB 查询', async () => {
    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'WECHAT_GLOBAL',
        deviceType: 'client_app',
      }),
    ).rejects.toMatchObject({ response: { code: 'E-PAYMENT-011' } });

    // Step 0 校验在 getInitialState 分流 + Step 1 查地址之前：零 DB 触达
    expect(mockDb.address.findUnique).not.toHaveBeenCalled();
    expect(mockHelpers.withTransaction).not.toHaveBeenCalled();
    expect(mockPayment.createIntentForOrder).not.toHaveBeenCalled();
  });

  it('批B R2：下单拒绝占位渠道 ALIPAY_CN / LOCAL_PSP（同口径 400 E-PAYMENT-011）', async () => {
    for (const method of ['ALIPAY_CN', 'LOCAL_PSP'] as const) {
      await expect(
        service.createOrder({
          userId: 'user-1',
          addressId: 'a1',
          items: [{ skuId: 'sku-1', quantity: 1 }],
          paymentMethod: method,
          deviceType: 'client_app',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-PAYMENT-011' } });
    }
    expect(mockDb.address.findUnique).not.toHaveBeenCalled();
  });

  it('批B R2：现有渠道放行——COD/WECHAT 经 Step 0 校验后继续走正常下单链路', async () => {
    // 放行证据 = Step 0 不拦截（异常码非 E-PAYMENT-011）；完整链路由上方 COD/WECHAT 汇率快照用例覆盖
    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'COD',
        deviceType: 'client_app',
      }),
    ).rejects.not.toMatchObject({ response: { code: 'E-PAYMENT-011' } });
    await expect(
      service.createOrder({
        userId: 'user-1',
        addressId: 'a1',
        items: [{ skuId: 'sku-1', quantity: 1 }],
        paymentMethod: 'WECHAT',
        deviceType: 'client_app',
      }),
    ).rejects.not.toMatchObject({ response: { code: 'E-PAYMENT-011' } });
    // 两个用例都通过了 Step 0，进入 Step 1 查地址
    expect(mockDb.address.findUnique).toHaveBeenCalled();
  });
});

});

describe('OrderService.adminUpdateOrder (W7-ext-C)', () => {
  let service: OrderService;

  beforeEach(() => {
    Object.values(mockDb).forEach((table) => {
      Object.values(table).forEach((fn) => fn.mockReset());
    });
    Object.values(mockHelpers).forEach((fn) => fn.mockReset());
    mockOrderNo.nextOrderNo.mockReset();
    mockPayment.createIntentForOrder.mockReset();
    mockCart.clearOrderedItems.mockReset();
    service = new OrderService(
      {} as never,
      mockOrderNo as never,
      {} as never,
      mockPayment as never,
      mockQueue as never,
      {} as never,
      mockCart as never,
      {} as never, // promotionService（markPaid 场景不用 coupon）
      {} as never, // pricingService（markPaid 场景不重算费）
      null, // realtime
      null, // notifyFactory
    );
  });

  function setupTxMock(order: { id: string; status: string; remark: string | null }) {
    const txFindUnique = vi.fn().mockResolvedValue(order);
    const txUpdate = vi.fn().mockResolvedValue({ ...order, remark: 'updated' });
    mockHelpers.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        order: { findUnique: txFindUnique, update: txUpdate },
        orderItem: {},
        orderEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
    return { txFindUnique, txUpdate };
  }

  function setupAdminGetOrderDetailMock(order: Record<string, unknown>) {
    mockDb.order.findUnique.mockResolvedValue({
      ...order,
      items: [],
      events: [],
      deliveryAddress: {},
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    });
  }

  it('订单不存在 -> 抛 E-ORDER-004', async () => {
    setupTxMock({ id: 'order-x', status: 'PENDING_CONFIRM', remark: null });
    mockDb.order.findUnique.mockResolvedValue(null);

    await expect(
      service.adminUpdateOrder('order-x', { remark: 'new note' }, { operatorId: 'admin-1' }),
    ).rejects.toMatchObject({
      response: { code: 'E-ORDER-004' },
      status: 404,
    });
  });

  it('CANCELLED 订单不可编辑 -> 抛 E-ORDER-003', async () => {
    setupTxMock({ id: 'order-1', status: 'CANCELLED', remark: null });
    setupAdminGetOrderDetailMock({ id: 'order-1', status: 'CANCELLED', remark: null });

    await expect(
      service.adminUpdateOrder('order-1', { remark: 'x' }, { operatorId: 'admin-1' }),
    ).rejects.toMatchObject({
      response: { code: 'E-ORDER-003' },
      status: 409,
    });
  });

  it('COMPLETED 订单不可编辑 -> 抛 E-ORDER-003', async () => {
    setupTxMock({ id: 'order-1', status: 'COMPLETED', remark: null });
    setupAdminGetOrderDetailMock({ id: 'order-1', status: 'COMPLETED', remark: null });

    await expect(
      service.adminUpdateOrder('order-1', { remark: 'x' }, { operatorId: 'admin-1' }),
    ).rejects.toMatchObject({
      response: { code: 'E-ORDER-003' },
      status: 409,
    });
  });

  it('空 input（无 remark 字段）-> 不调用 update，仍走 detail 查询', async () => {
    const { txUpdate } = setupTxMock({ id: 'order-1', status: 'CONFIRMED', remark: 'old' });
    setupAdminGetOrderDetailMock({ id: 'order-1', status: 'CONFIRMED', remark: 'old' });

    const result = await service.adminUpdateOrder('order-1', {}, { operatorId: 'admin-1' });
    expect(txUpdate).not.toHaveBeenCalled();
    expect(result.id).toBe('order-1');
  });

  it('Happy path：remark 修改 -> 调 update + 返回详情', async () => {
    const { txUpdate } = setupTxMock({ id: 'order-1', status: 'CONFIRMED', remark: 'old' });
    setupAdminGetOrderDetailMock({ id: 'order-1', status: 'CONFIRMED', remark: 'updated note' });

    const result = await service.adminUpdateOrder(
      'order-1',
      { remark: 'updated note' },
      { operatorId: 'admin-1' },
    );

    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { remark: 'updated note' },
    });
    expect(result.id).toBe('order-1');
  });

  it('remark=null 清空备注', async () => {
    const { txUpdate } = setupTxMock({ id: 'order-1', status: 'CONFIRMED', remark: 'old' });
    setupAdminGetOrderDetailMock({ id: 'order-1', status: 'CONFIRMED', remark: null });

    await service.adminUpdateOrder('order-1', { remark: null }, { operatorId: 'admin-1' });

    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { remark: null },
    });
  });

  it('remark 超长截断到 200 字符', async () => {
    const { txUpdate } = setupTxMock({ id: 'order-1', status: 'CONFIRMED', remark: 'old' });
    setupAdminGetOrderDetailMock({ id: 'order-1', status: 'CONFIRMED', remark: 'x'.repeat(200) });

    const longRemark = 'x'.repeat(250);
    await service.adminUpdateOrder(
      'order-1',
      { remark: longRemark },
      { operatorId: 'admin-1' },
    );

    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { remark: 'x'.repeat(200) },
    });
  });
});

/**
 * OrderService.getOrderDetail / adminGetOrderDetail（P10/P11 项 1：骑手详情嵌套）
 *
 * 验证 toOrderWithRelations 转换器对 rider 的处理：
 *   - 有 rider（详情接口 include）→ rider 嵌套对象，rating Decimal→string，avatarUrl 从 user 平铺
 *   - 无 rider（列表接口未 include 或 riderId=null）→ rider: null
 */
describe('OrderService.getOrderDetail (P10/P11 rider 嵌套)', () => {
  let service: OrderService;

  beforeEach(() => {
    Object.values(mockDb).forEach((table) => {
      Object.values(table).forEach((fn) => fn.mockReset());
    });
    service = new OrderService(
      {} as never, // orderNoService（getOrderDetail 不用）
      {} as never, // paymentService
      {} as never, // timeoutQueue
      null, // dispatchService
      null, // cartService
      {} as never, // promotionService
      {} as never, // pricingService
      null, // realtime
      null, // notifyFactory
    );
  });

  it('有 riderId + include rider → rider 嵌套（rating Decimal→string, avatarUrl 从 user 平铺）', async () => {
    mockDb.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNo: 'MM20260625010000001',
      userId: 'user-1',
      warehouseId: 'wh-1',
      status: 'DELIVERING',
      totalAmount: 200,
      deliveryFee: 0,
      discountAmount: 0,
      payableAmount: 200,
      deliveryAddress: {},
      remark: null,
      riderId: 'rider-1',
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      paidAt: new Date('2026-06-25T00:00:00.000Z'),
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      confirmedAt: null,
      pickedAt: null,
      deliveringAt: null,
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      items: [],
      events: [],
      orderPromotions: [],
      rider: {
        id: 'rider-1',
        riderName: 'João',
        phone: '+67012345678',
        rating: new Prisma.Decimal('4.50'),
        totalDeliveries: 23,
        vehicleType: 'MOTORCYCLE',
        user: { avatarUrl: 'https://cdn.example.com/rider-1.png' },
      },
    });

    const result = await service.getOrderDetail('order-1', 'user-1');

    expect(result.riderId).toBe('rider-1');
    expect(result.rider).toEqual({
      id: 'rider-1',
      riderName: 'João',
      phone: '+67012345678',
      rating: '4.5', // Decimal(3,2) → string（decimal.js normalize 去 0，前端 parseFloat 展示）
      totalDeliveries: 23,
      vehicleType: 'MOTORCYCLE',
      avatarUrl: 'https://cdn.example.com/rider-1.png', // 从 user.avatarUrl 平铺
    });
  });

  it('无 riderId（订单未分配骑手）→ rider: null', async () => {
    mockDb.order.findUnique.mockResolvedValue({
      id: 'order-2',
      orderNo: 'MM20260625010000002',
      userId: 'user-1',
      warehouseId: 'wh-1',
      status: 'PENDING_CONFIRM',
      totalAmount: 100,
      deliveryFee: 0,
      discountAmount: 0,
      payableAmount: 100,
      deliveryAddress: {},
      remark: null,
      riderId: null,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      paidAt: null,
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      confirmedAt: null,
      pickedAt: null,
      deliveringAt: null,
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      items: [],
      events: [],
      orderPromotions: [],
      // 列表接口未 include rider（无 rider 字段）— 验证转换器对 undefined 安全
    });

    const result = await service.getOrderDetail('order-2', 'user-1');

    expect(result.riderId).toBeNull();
    expect(result.rider).toBeNull();
  });

  it('有 riderId 但 rider.user 为 null（防御：骑手 User 删账户边界）→ avatarUrl: null', async () => {
    mockDb.order.findUnique.mockResolvedValue({
      id: 'order-3',
      orderNo: 'MM20260625010000003',
      userId: 'user-1',
      warehouseId: 'wh-1',
      status: 'DELIVERING',
      totalAmount: 200,
      deliveryFee: 0,
      discountAmount: 0,
      payableAmount: 200,
      deliveryAddress: {},
      remark: null,
      riderId: 'rider-3',
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      paidAt: new Date('2026-06-25T00:00:00.000Z'),
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      confirmedAt: null,
      pickedAt: null,
      deliveringAt: null,
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      items: [],
      events: [],
      orderPromotions: [],
      rider: {
        id: 'rider-3',
        riderName: 'Bob',
        phone: '+67099999999',
        rating: new Prisma.Decimal('5.00'),
        totalDeliveries: 0,
        vehicleType: 'MOTORCYCLE',
        user: null, // 防御性：理论不应发生（FK 约束），但转换器需安全
      },
    });

    const result = await service.getOrderDetail('order-3', 'user-1');

    expect(result.rider).toEqual({
      id: 'rider-3',
      riderName: 'Bob',
      phone: '+67099999999',
      rating: '5',
      totalDeliveries: 0,
      vehicleType: 'MOTORCYCLE',
      avatarUrl: null, // user 为 null → 兜底 null
    });
  });
});

// ============================================================
// 批A 销量真实统计（2026-09-07）：markPaidTx 支付成功累加
// 单点覆盖三条 PAID 路径（mock 回调 / 客户端 confirm 轮询 / admin confirm-receipt），
// 三路径都收敛到本方法；累加 helper 逻辑在 sales-count.helper.test.ts 单测
// ============================================================
describe('OrderService.markPaidTx - 批A 销量真实统计', () => {
  let service: OrderService;

  beforeEach(() => {
    Object.values(mockDb).forEach((table) => {
      Object.values(table).forEach((fn) => fn.mockReset());
    });
    Object.values(mockHelpers).forEach((fn) => fn.mockReset());
    mockSalesIncrement.mockReset();
    service = new OrderService(
      new (class { nextOrderNo = mockOrderNo.nextOrderNo })(),
      mockPayment,
      mockQueue,
      null, // dispatchService
      mockCart, // cartService
      {} as never, // promotionService
      new (class { calcDeliveryFee = mockPricing.calcDeliveryFee })(), // pricingService
      null, // realtime
      null, // notifyFactory
    );
  });

  function mockPaidOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-1',
      orderNo: 'MM20260907010000001',
      userId: 'user-1',
      warehouseId: 'wh-1',
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      paymentMethod: 'WECHAT',
      payableAmount: 500,
      ...overrides,
    };
  }

  it('PENDING_PAYMENT 支付成功 → 条件翻转 CONFIRMED + 累加销量（operatorId 透传 eventCtx）', async () => {
    mockDb.order.findUnique.mockResolvedValue(mockPaidOrder());
    mockDb.order.updateMany.mockResolvedValue({ count: 1 });
    mockDb.orderEvent.create.mockResolvedValue({});

    await service.markPaidTx(mockDb as never, 'order-1', { operatorId: 'user-1' });

    // P2-1：COMPLETED 翻转走 updateMany 条件更新（状态作 WHERE 前置封并发）
    expect(mockDb.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'order-1' }),
        data: expect.objectContaining({ status: 'CONFIRMED', paymentStatus: 'PAID' }),
      }),
    );
    expect(mockSalesIncrement).toHaveBeenCalledTimes(1);
    expect(mockSalesIncrement).toHaveBeenCalledWith(mockDb, 'order-1', { operatorId: 'user-1' });
  });

  it('P1-1：BANK_TRANSFER PENDING_CONFIRM（admin confirm-receipt）→ 放行 + 累加销量', async () => {
    mockDb.order.findUnique.mockResolvedValue(
      mockPaidOrder({ status: 'PENDING_CONFIRM', paymentMethod: 'BANK_TRANSFER' }),
    );
    mockDb.order.updateMany.mockResolvedValue({ count: 1 });
    mockDb.orderEvent.create.mockResolvedValue({});

    await service.markPaidTx(mockDb as never, 'order-1', { operatorId: 'admin-1' });

    expect(mockDb.order.updateMany).toHaveBeenCalledTimes(1);
    expect(mockSalesIncrement).toHaveBeenCalledTimes(1);
    expect(mockSalesIncrement).toHaveBeenCalledWith(mockDb, 'order-1', { operatorId: 'admin-1' });
  });

  it('P1-1 守卫：COD PENDING_CONFIRM 不放行（收款走 deliverTask，防双路径）', async () => {
    mockDb.order.findUnique.mockResolvedValue(
      mockPaidOrder({ status: 'PENDING_CONFIRM', paymentMethod: 'COD' }),
    );

    await expect(
      service.markPaidTx(mockDb as never, 'order-1', { operatorId: 'admin-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-ORDER-003' } });

    expect(mockSalesIncrement).not.toHaveBeenCalled();
  });

  it('P2-1 并发输家：条件翻转 count=0 且最新状态已 PAID → 幂等 return 不重复累加', async () => {
    mockDb.order.findUnique
      .mockResolvedValueOnce(mockPaidOrder()) // 首读：未付（并发窗口内）
      .mockResolvedValueOnce(mockPaidOrder({ paymentStatus: 'PAID', status: 'CONFIRMED' })); // count=0 后重读
    mockDb.order.updateMany.mockResolvedValue({ count: 0 }); // 并发赢家已翻走

    await service.markPaidTx(mockDb as never, 'order-1', { operatorId: 'user-1' });

    expect(mockSalesIncrement).not.toHaveBeenCalled();
    expect(mockDb.orderEvent.create).not.toHaveBeenCalled();
  });

  it('重复回调幂等：paymentStatus 已 PAID → 提前 return 不重复累加', async () => {
    mockDb.order.findUnique.mockResolvedValue(mockPaidOrder({ paymentStatus: 'PAID' }));

    await service.markPaidTx(mockDb as never, 'order-1', { operatorId: 'user-1' });

    expect(mockDb.order.updateMany).not.toHaveBeenCalled();
    expect(mockSalesIncrement).not.toHaveBeenCalled();
  });

  it('状态机拒绝（CONFIRMED 非 PENDING_PAYMENT）→ 抛 E-ORDER-003 且不累加', async () => {
    mockDb.order.findUnique.mockResolvedValue(mockPaidOrder({ status: 'DELIVERING' }));

    await expect(
      service.markPaidTx(mockDb as never, 'order-1', { operatorId: 'user-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-ORDER-003' } });

    expect(mockSalesIncrement).not.toHaveBeenCalled();
  });
});
