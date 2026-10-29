/**
 * 替换品批1 单测（2026-10-29）
 *
 * 覆盖：
 *   - 登记链策略校验（D9/D13）：NONE 禁建议项 → E-OOS-009；SPECIFY 建议项不在白名单 → E-OOS-010；
 *     SPECIFY 白名单命中 → 合法；ALLOW → 不限
 *   - D6 PENDING 不直退：带建议项 ALLOW 单 → 引擎不触发；无建议项 → 引擎照常触发
 *   - 决策端点（D5/D8/D1）：非 PENDING → 409 E-OOS-011；ACCEPTED 落单价=min + 快照改写 +
 *     payable 重算 + REPLACED 事件 + 差额退款；DECLINED → 走退款链
 *
 * mock：db + withTransaction 透传（out-of-stock.service.test.ts 同款范式）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    orderEvent: { create: vi.fn() },
    sku: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OutOfStockService } from '../src/modules/order/out-of-stock.service';
import { OrderService } from '../src/modules/order/order.service';

function buildItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    orderId: 'order-1',
    productId: 'p-1',
    skuId: 'sku-1',
    productName: { en: 'Milk' },
    productImage: 'img-1',
    skuName: { en: 'Milk 1L' },
    unitPrice: 500,
    quantity: 2,
    subtotal: 1000,
    outOfStockQty: null,
    suggestionItemId: null,
    suggestionStatus: null,
    suggestionDecidedAt: null,
    ...overrides,
  };
}

// 决策链测试用：item 默认带 PENDING（决策前置条件）；需覆盖时在 overrides 里改
const p = (o: Record<string, unknown> = {}) => buildItem({ suggestionStatus: 'PENDING', suggestionItemId: 'item-2', ...o });

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'MM2026102901000001',
    userId: 'u1',
    warehouseId: 'wh-1',
    status: 'CONFIRMED',
    deliveryFee: 500,
    discountAmount: 0,
    payableAmount: 1500,
    deletedAt: null,
    replacementPolicy: 'ALLOW',
    allowedReplacementSkuIds: null,
    items: [buildItem()],
    ...overrides,
  };
}

const baseInput = {
  operatorId: 'admin-1',
  deviceType: 'admin_web' as const,
  outOfStockQty: 1,
  reason: 'DAMAGED' as const,
};

// ===================== 登记链策略校验（D9/D13） =====================

describe('OutOfStockService 替换策略校验（批1 D9/D13）', () => {
  let service: OutOfStockService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OutOfStockService(null, { cancelOrderInternal: vi.fn() } as never);
    mockDb.orderItem.findUnique.mockResolvedValue(buildItem({ suggestionItemId: null }));
    mockDb.orderItem.update.mockResolvedValue({});
    mockDb.orderItem.findMany.mockResolvedValue([p({ outOfStockQty: 1 })]);
    mockDb.orderEvent.create.mockResolvedValue({});
    mockDb.order.update.mockResolvedValue({});
  });

  it('NONE 策略带建议项 → E-OOS-009', async () => {
    mockDb.order.findUnique
      .mockResolvedValueOnce(buildOrder({ replacementPolicy: 'NONE' })) // 预读
      .mockResolvedValueOnce({ replacementPolicy: 'NONE', allowedReplacementSkuIds: null }); // 策略校验
    await expect(
      service.adminReportItemOutOfStock('order-1', 'item-1', { ...baseInput, suggestionItemId: 'item-2' }),
    ).rejects.toMatchObject({ response: { code: 'E-OOS-009' } });
  });

  it('SPECIFY 建议项 skuId 不在白名单 → E-OOS-010', async () => {
    mockDb.order.findUnique
      .mockResolvedValueOnce(buildOrder({ replacementPolicy: 'SPECIFY', allowedReplacementSkuIds: ['sku-9'] }))
      .mockResolvedValueOnce({
        replacementPolicy: 'SPECIFY',
        allowedReplacementSkuIds: ['sku-9'],
      });
    // 建议项（item-2）skuId=sku-2 ∉ 白名单 ['sku-9']
    mockDb.orderItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'item-1' ? buildItem() : buildItem({ id: 'item-2', skuId: 'sku-2' }),
    );
    await expect(
      service.adminReportItemOutOfStock('order-1', 'item-1', { ...baseInput, suggestionItemId: 'item-2' }),
    ).rejects.toMatchObject({ response: { code: 'E-OOS-010' } });
  });

  it('SPECIFY 白名单命中 → 合法，置 PENDING（D6）', async () => {
    mockDb.order.findUnique
      .mockResolvedValueOnce(buildOrder({ replacementPolicy: 'SPECIFY', allowedReplacementSkuIds: ['sku-2'] }))
      .mockResolvedValueOnce({
        replacementPolicy: 'SPECIFY',
        allowedReplacementSkuIds: ['sku-2'],
      })
      .mockResolvedValueOnce(buildOrder({ replacementPolicy: 'SPECIFY', allowedReplacementSkuIds: ['sku-2'] })) // policyAllowsSuggestion
      .mockResolvedValueOnce(buildOrder({ replacementPolicy: 'SPECIFY', allowedReplacementSkuIds: ['sku-2'] })); // 全缺判定重读
    mockDb.orderItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'item-1' ? buildItem() : buildItem({ id: 'item-2', skuId: 'sku-2' }),
    );
    const result = await service.adminReportItemOutOfStock('order-1', 'item-1', {
      ...baseInput,
      suggestionItemId: 'item-2',
    });
    expect(result.suggestionPending).toBe(true);
    // update data 含 suggestionStatus PENDING
    expect(mockDb.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ suggestionStatus: 'PENDING' }),
      }),
    );
  });

  it('ALLOW 带建议项 → 置 PENDING（D6）', async () => {
    mockDb.order.findUnique.mockResolvedValue(buildOrder());
    const result = await service.adminReportItemOutOfStock('order-1', 'item-1', {
      ...baseInput,
      suggestionItemId: 'item-2',
    });
    expect(result.suggestionPending).toBe(true);
  });

  it('ALLOW 无建议项 → 不置 PENDING', async () => {
    mockDb.order.findUnique.mockResolvedValue(buildOrder());
    const result = await service.adminReportItemOutOfStock('order-1', 'item-1', baseInput);
    expect(result.suggestionPending).toBe(false);
    expect(mockDb.orderItem.update).toHaveBeenCalledWith(
      expect.not.objectContaining({
        data: expect.objectContaining({ suggestionStatus: expect.anything() }),
      }),
    );
  });
});

// ===================== 决策端点（D5/D8/D1） =====================

describe('OrderService.decideSuggestion（批1 D5/D8/D1）', () => {
  let service: OrderService;
  const refundEngine = { processOutOfStockRefund: vi.fn() };

  function buildService(orderOverride: Record<string, unknown> = {}) {
    refundEngine.processOutOfStockRefund.mockReset().mockResolvedValue({
      triggered: true, refundId: 'r-1', amount: 200, mode: 'direct',
    });
    service = new OrderService(
      {} as never, // orderNoService
      {} as never, // paymentService
      {} as never, // timeoutQueue
      null, // dispatchService
      null, // cartService
      {} as never, // promotionService
      {} as never, // pricingService
      null, // realtime
      null, // notifyFactory
      null, // notificationEvents
      refundEngine as never,
    );
    return orderOverride;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    buildService();
    mockDb.order.update.mockResolvedValue({});
    mockDb.orderEvent.create.mockResolvedValue({});
    mockDb.orderItem.findMany.mockResolvedValue([buildItem()]);
  });

  it('非 PENDING → 409 E-OOS-011（D5 幂等）', async () => {
    mockDb.order.findUnique.mockResolvedValue(
      buildOrder({ items: [p({ suggestionStatus: 'ACCEPTED' })] }),
    );
    await expect(
      service.decideSuggestion('order-1', 'item-1', 'u1', { accept: true }),
    ).rejects.toMatchObject({ response: { code: 'E-OOS-011' } });
  });

  it('非本人订单 → 404', async () => {
    mockDb.order.findUnique.mockResolvedValue(buildOrder({ userId: 'someone-else' }));
    await expect(
      service.decideSuggestion('order-1', 'item-1', 'u1', { accept: true }),
    ).rejects.toMatchObject({ response: { code: 'E-ORDER-004' } });
  });

  it('ACCEPTED：落单价=min(替换价,原价)（D1 钳制）+ 快照改写 + REPLACED 事件 + 差额退款', async () => {
    // 原价 500，替换价 700 → 落单价 500（钳制），差额 = (500-500)=0 → 无退款
    mockDb.order.findUnique.mockResolvedValue(
      buildOrder({
        items: [
          p(),
          buildItem({ id: 'item-2', skuId: 'sku-2', productId: 'p-2', unitPrice: 700, subtotal: 1400, productName: { en: 'Cream' } }),
        ],
      }),
    );
    const result = await service.decideSuggestion('order-1', 'item-1', 'u1', { accept: true });
    expect(result.suggestionStatus).toBe('ACCEPTED');
    expect(result.replacementItemId).toBe('item-2');
    // update 快照改写：unitPrice=500（min）、skuId 换成替换行、suggestionStatus=ACCEPTED
    expect(mockDb.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          skuId: 'sku-2',
          unitPrice: 500,
          subtotal: 1000,
          suggestionStatus: 'ACCEPTED',
        }),
      }),
    );
    // REPLACED 事件
    expect(mockDb.orderEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'REPLACED' }),
      }),
    );
    // 落单价==原价 → 差额 0，退款引擎不触发
    expect(refundEngine.processOutOfStockRefund).not.toHaveBeenCalled();
  });

  it('ACCEPTED：替换价低于原价 → 差额退款（D1）', async () => {
    // 原价 500，替换价 400 → 落单价 400，差额 = (500-400)×2 = 200
    mockDb.order.findUnique.mockResolvedValue(
      buildOrder({
        items: [
          p(),
          buildItem({ id: 'item-2', skuId: 'sku-2', productId: 'p-2', unitPrice: 400, subtotal: 800 }),
        ],
      }),
    );
    const result = await service.decideSuggestion('order-1', 'item-1', 'u1', { accept: true });
    expect(result.refundedAmount).toBe(200);
    expect(refundEngine.processOutOfStockRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        fullShortage: false,
        items: [expect.objectContaining({ unitPrice: 100, refundQty: 2 })],
      }),
    );
  });

  it('DECLINED：置 DECLINED + 走退款链（D6）', async () => {
    // triggerDeclinedRefund 事务外重读 item（select skuId/productName/unitPrice/outOfStockQty）
    mockDb.orderItem.findUnique.mockResolvedValue(
      buildItem({ outOfStockQty: 1 }),
    );
    mockDb.order.findUnique.mockResolvedValue(
      buildOrder({ items: [p({ outOfStockQty: 1 }), buildItem({ id: 'item-2', skuId: 'sku-2', productId: 'p-2' })] }),
    );
    const result = await service.decideSuggestion('order-1', 'item-1', 'u1', { accept: false });
    expect(result.suggestionStatus).toBe('DECLINED');
    expect(mockDb.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-1' },
        data: expect.objectContaining({ suggestionStatus: 'DECLINED' }),
      }),
    );
    expect(refundEngine.processOutOfStockRefund).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', fullShortage: false }),
    );
  });

  it('replacementItemId 不属本单 → E-OOS-002', async () => {
    mockDb.order.findUnique.mockResolvedValue(buildOrder({ items: [p()] }));
    await expect(
      service.decideSuggestion('order-1', 'item-1', 'u1', { accept: true, replacementItemId: 'item-x' }),
    ).rejects.toMatchObject({ response: { code: 'E-OOS-002' } });
  });

  it('无登记建议项且未传 replacementItemId → E-OOS-002', async () => {
    mockDb.order.findUnique.mockResolvedValue(
      buildOrder({ items: [buildItem({ suggestionStatus: 'PENDING' })] }),
    );
    await expect(
      service.decideSuggestion('order-1', 'item-1', 'u1', { accept: true }),
    ).rejects.toMatchObject({ response: { code: 'E-OOS-002' } });
  });
});

// ===================== P1-2 修复（2026-10-29 调度拍板方案 a）：全缺 × PENDING 豁免 + 决策后重判 =====================

describe('P1-2 全缺豁免与决策后重判（2026-10-29）', () => {
  let service: OutOfStockService;
  let orderService: OrderService;
  const refundEngine = { processOutOfStockRefund: vi.fn() };
  const cancelOrderInternal = vi.fn();

  function buildDecisionService() {
    refundEngine.processOutOfStockRefund.mockReset().mockResolvedValue({
      triggered: true, refundId: 'r-1', amount: 1000, mode: 'direct',
    });
    cancelOrderInternal.mockReset().mockResolvedValue(undefined);
    orderService = new OrderService(
      {} as never, {} as never, {} as never, null, null,
      {} as never, {} as never, null, null, null,
      refundEngine as never,
    );
    // cancelOrderInternal 替换为 spy（rejudgeFullyOutOfStock 依赖）
    Object.assign(orderService, { cancelOrderInternal });
    service = new OutOfStockService(null, orderService as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    buildDecisionService();
    // clearAllMocks 只清调用记录不清实现——前面 describe 的 mockResolvedValue 会泄漏，
    // 显式 reset 并给默认（item 默认未登记缺货）
    mockDb.orderItem.findUnique.mockReset().mockResolvedValue(buildItem());
    mockDb.orderItem.findMany.mockReset();
    mockDb.order.update.mockResolvedValue({});
    mockDb.orderEvent.create.mockResolvedValue({});
    mockDb.orderItem.update.mockResolvedValue({});
  });

  it('整单 1 项全缺 + PENDING 建议 → cancelIfFullyOutOfStock 豁免：订单不取消', async () => {
    // 建议项 item-2 归属校验读取
    mockDb.orderItem.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'item-1' ? buildItem() : buildItem({ id: 'item-2', skuId: 'sku-2' }),
    );
    // 登记链 order.findUnique 调用序：1 preOrder → 2 策略校验 → 3 policyAllowsSuggestion
    // → 4 writeReportEvent（读 status）→ 5 cancelIfFullyOutOfStock（全缺判定，include items）
    mockDb.order.findUnique
      .mockResolvedValueOnce(buildOrder())
      .mockResolvedValueOnce(buildOrder())
      .mockResolvedValueOnce(buildOrder())
      .mockResolvedValueOnce(buildOrder())
      .mockResolvedValueOnce(
        buildOrder({
          items: [
            buildItem({ outOfStockQty: 2, suggestionStatus: 'PENDING', suggestionItemId: 'item-2' }),
            buildItem({ id: 'item-2', skuId: 'sku-2', productId: 'p-2' }),
          ],
        }),
      ); // 全缺判定重读：item-1 全缺但带 PENDING → 豁免
    const result = await service.adminReportItemOutOfStock('order-1', 'item-1', {
      ...baseInput,
      suggestionItemId: 'item-2',
    });
    // 订单未取消（P1-2 死锁修复核心断言）
    expect(result.orderCancelled).toBe(false);
    expect(cancelOrderInternal).not.toHaveBeenCalled();
  });

  it('整单全缺 + 无 PENDING → 登记链照常取消（既有行为不回归）', async () => {
    // order.findUnique 调用序（无建议项）：1 preOrder → 2 writeReportEvent → 3 全缺判定
    mockDb.order.findUnique
      .mockResolvedValueOnce(buildOrder())
      .mockResolvedValueOnce(buildOrder())
      .mockResolvedValueOnce(
        buildOrder({
          items: [buildItem({ outOfStockQty: 2 })],
        }),
      ); // 全缺判定重读：全缺且无 PENDING → 取消
    const result = await service.adminReportItemOutOfStock('order-1', 'item-1', baseInput);
    expect(result.orderCancelled).toBe(true);
    expect(cancelOrderInternal).toHaveBeenCalledTimes(1);
  });

  it('DECLINED 决策后 rejudgeFullyOutOfStock → 取消 + 全缺退款（fullShortage=true）', async () => {
    // decideSuggestion 主链
    mockDb.order.findUnique.mockResolvedValueOnce(
      buildOrder({ items: [p({ outOfStockQty: 2, quantity: 2 }), buildItem({ id: 'item-2', skuId: 'sku-2', productId: 'p-2', outOfStockQty: 2, quantity: 2 })] }),
    );
    // triggerDeclinedRefund 事务外重读 item
    mockDb.orderItem.findUnique.mockResolvedValueOnce(buildItem({ outOfStockQty: 2, quantity: 2 }));
    // rejudgeFullyOutOfStock：重读整单（此时建议已 DECLINED，两行全缺）
    mockDb.order.findUnique.mockResolvedValueOnce({
      status: 'CONFIRMED',
      warehouseId: 'wh-1',
      items: [
        { outOfStockQty: 2, quantity: 2 },
        { outOfStockQty: 2, quantity: 2 },
      ],
    });
    // 引擎候选构造读 items
    mockDb.orderItem.findMany.mockResolvedValueOnce([
      { id: 'item-1', skuId: 'sku-1', productName: { en: 'Milk' }, unitPrice: 500, outOfStockQty: 2 },
      { id: 'item-2', skuId: 'sku-2', productName: { en: 'Cream' }, unitPrice: 700, outOfStockQty: 2 },
    ]);
    // decideSuggestion 挂在 OrderService 上；本 describe 的 service 是 OutOfStockService
    const result = await orderService.decideSuggestion('order-1', 'item-1', 'u1', { accept: false });
    expect(result.suggestionStatus).toBe('DECLINED');
    expect(cancelOrderInternal).toHaveBeenCalledTimes(1);
    expect(cancelOrderInternal).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ reason: 'OUT_OF_STOCK' }),
    );
    // 全缺退款触发（fullShortage=true 走引擎规则）
    expect(refundEngine.processOutOfStockRefund).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', fullShortage: true }),
    );
  });

  it('ACCEPTED 决策后替换落单 → 不触发全缺退款（正常履约）', async () => {
    // 两行：item-1 全缺 PENDING（建议 item-2），item-2 未缺货 —— ACCEPTED 后替换落单
    mockDb.order.findUnique.mockResolvedValueOnce(
      buildOrder({
        items: [
          p({ outOfStockQty: 2, quantity: 2 }),
          buildItem({ id: 'item-2', skuId: 'sku-2', productId: 'p-2', unitPrice: 400, subtotal: 800 }),
        ],
      }),
    );
    mockDb.order.findUnique.mockResolvedValueOnce({
      status: 'CONFIRMED',
      warehouseId: 'wh-1',
      // rejudge 不应被调用于 ACCEPTED 路径；即便误调，item-2 未缺货 → not fullyShort
      items: [
        { outOfStockQty: 2, quantity: 2 },
        { outOfStockQty: null, quantity: 2 },
      ],
    });
    // ACCEPTED 差额退款（400<500 → 差额 (500-400)×2=200）走事务内 orderItem.findMany
    mockDb.orderItem.findMany
      .mockResolvedValueOnce([
        { id: 'item-1', skuId: 'sku-2', subtotal: 800 },
        { id: 'item-2', skuId: 'sku-2', productId: 'p-2', subtotal: 800 },
      ]) // 金额重算
      .mockResolvedValueOnce([
        { id: 'item-1', skuId: 'sku-1', productName: { en: 'Milk' }, unitPrice: 400, outOfStockQty: 2 },
      ]); // 差额退款候选（refundQty=2, unitPrice=100）
    const result = await orderService.decideSuggestion('order-1', 'item-1', 'u1', { accept: true });
    expect(result.suggestionStatus).toBe('ACCEPTED');
    // 订单存活：不取消、无全缺退款（差额退款 fullShortage=false 走 D1 通路，属正常）
    expect(cancelOrderInternal).not.toHaveBeenCalled();
    expect(refundEngine.processOutOfStockRefund).not.toHaveBeenCalledWith(
      expect.objectContaining({ fullShortage: true }),
    );
  });
});
