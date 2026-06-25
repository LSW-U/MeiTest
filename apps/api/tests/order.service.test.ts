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

const { mockDb, mockHelpers, mockOrderNo, mockPayment, mockQueue } = vi.hoisted(() => ({
  mockDb: {
    address: { findUnique: vi.fn() },
    sku: { findMany: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
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
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: mockHelpers.withTransaction,
  deductStock: mockHelpers.deductStock,
  releaseStock: mockHelpers.releaseStock,
  findWarehouseByPoint: mockHelpers.findWarehouseByPoint,
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

    service = new OrderService(
      new (class { nextOrderNo = mockOrderNo.nextOrderNo })(),
      mockPayment,
      mockQueue,
      null, // dispatchService（happy path 中 markPaid 才用，createOrder 不调）
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
    mockPayment.createIntentForOrder.mockResolvedValue({
      intentId: 'pi-1',
      status: 'PENDING',
      clientSecret: undefined,
      mockFlag: false,
    });

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

    // enqueueOrderTimeout 被调用（mock 模块捕获）
    // 由于 enqueueOrderTimeout 是 vi.fn() mock 的 module，需要 expect mock 被调
    // 简化验证：mockQueue.add 不直接调（enqueueOrderTimeout 内部用），但我们 mock helper 时
    // 没有验证调用 — 改成验证 helper 被调
    const { enqueueOrderTimeout } = await import('../src/modules/order/order-timeout.helper');
    expect(enqueueOrderTimeout).toHaveBeenCalled();
  });
});
