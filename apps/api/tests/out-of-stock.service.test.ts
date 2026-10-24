/**
 * OutOfStockService 单测（缺货履约闭环批1 2026-10-24）
 *
 * 覆盖（任务书批1 校验四件 + 全缺判定 D11 + 骑手段禁全缺 D12）：
 *   - 窗口非法 → E-OOS-001（admin CONFIRMED/PICKED 之外 / rider 非 OUT_FOR_DELIVERY）
 *   - 数量非法 → E-OOS-002（0 / 负数 / 超 quantity）
 *   - 重复登记 → E-OOS-003
 *   - 骑手段全缺 → E-OOS-004（D12）
 *   - 证据非法 → E-OOS-005（>3 / 外部前缀 isOwnUrl）
 *   - suggestionItemId 跨单 → E-OOS-002（D18 本单归属）
 *   - happy path：落字段 + 写 OUT_OF_STOCK_REPORTED 事件
 *   - 全缺判定：整单全部项缺 → cancelOrderInternal（reason=OUT_OF_STOCK），orderCancelled=true
 *   - 部分缺：不取消，orderCancelled=false
 *
 * mock：db + OrderService.cancelOrderInternal + StorageService（null / mock isOwnUrl 两态，
 * 对齐 dispatch.service.test.ts storage 注入范式）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    order: { findUnique: vi.fn() },
    orderItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    orderEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  // P2-1：登记链事务化——mock 透传 fn，fn(mockDb as tx) 行为与真实 withTransaction 一致
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OutOfStockService } from '../src/modules/order/out-of-stock.service';

function buildItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    orderId: 'order-1',
    skuId: 'sku-1',
    quantity: 3,
    outOfStockQty: null,
    outOfStockReason: null,
    outOfStockNote: null,
    outOfStockEvidenceUrls: [],
    suggestionItemId: null,
    ...overrides,
  };
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    status: 'CONFIRMED',
    userId: 'u1',
    warehouseId: 'wh-1',
    items: [buildItem()],
    ...overrides,
  };
}

const baseInput = {
  operatorId: 'admin-1',
  deviceType: 'admin_web' as const,
  outOfStockQty: 2,
  reason: 'DAMAGED' as const,
};

describe('OutOfStockService', () => {
  let service: OutOfStockService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OutOfStockService(null, { cancelOrderInternal: vi.fn() } as never);
  });

  describe('adminReportItemOutOfStock 窗口与校验', () => {
    it('订单不存在 → E-ORDER-004', async () => {
      mockDb.order.findUnique.mockResolvedValue(null);
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', baseInput),
      ).rejects.toMatchObject({ response: { code: 'E-ORDER-004' } });
    });

    it.each(['PENDING_CONFIRM', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])(
      '窗口外状态 %s → E-OOS-001',
      async (status) => {
        mockDb.order.findUnique.mockResolvedValue(buildOrder({ status }));
        await expect(
          service.adminReportItemOutOfStock('order-1', 'item-1', baseInput),
        ).rejects.toMatchObject({ response: { code: 'E-OOS-001' } });
      },
    );

    it('PICKED 窗口合法（与 CONFIRMED 同窗口）', async () => {
      mockDb.order.findUnique
        .mockResolvedValueOnce(buildOrder({ status: 'PICKED' })) // 预读
        .mockResolvedValueOnce(buildOrder({ status: 'PICKED' })); // 全缺判定重读
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem());
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});
      const result = await service.adminReportItemOutOfStock('order-1', 'item-1', baseInput);
      expect(result.orderCancelled).toBe(false);
    });

    it('项不存在或不属于本单 → E-ORDER-005', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem({ orderId: 'other-order' }));
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', baseInput),
      ).rejects.toMatchObject({ response: { code: 'E-ORDER-005' } });
    });

    it.each([0, -1, 4, 2.5])('数量非法 %s → E-OOS-002', async (qty) => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem({ quantity: 3 }));
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', { ...baseInput, outOfStockQty: qty }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-002' } });
    });

    it('重复登记（已有 outOfStockQty）→ E-OOS-003', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem({ outOfStockQty: 1 }));
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', baseInput),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-003' } });
    });

    it('suggestionItemId 跨单引用 → E-OOS-002（D18 本单归属）', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique
        .mockResolvedValueOnce(buildItem()) // 目标项
        .mockResolvedValueOnce(buildItem({ id: 'item-x', orderId: 'other-order' })); // 建议项
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', {
          ...baseInput,
          suggestionItemId: 'item-x',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-002' } });
    });

    it('suggestionItemId 指向自身 → E-OOS-002（P3-3 自身禁判）', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem());
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', {
          ...baseInput,
          suggestionItemId: 'item-1',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-002' } });
    });

    it('>3 张证据 → E-OOS-005（防御直调）', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem());
      await expect(
        service.adminReportItemOutOfStock('order-1', 'item-1', {
          ...baseInput,
          evidenceUrls: ['http://a/1', 'http://a/2', 'http://a/3', 'http://a/4'],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-005' } });
    });

    it('外部前缀证据 URL → E-OOS-005（isOwnUrl 语义，注入 mock storage 验证前缀分支）', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder());
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem());
      const withStorage = new OutOfStockService(
        { isOwnUrl: (url: string) => url.startsWith('http://own/meimart/') } as never,
        { cancelOrderInternal: vi.fn() } as never,
      );
      await expect(
        withStorage.adminReportItemOutOfStock('order-1', 'item-1', {
          ...baseInput,
          evidenceUrls: ['https://evil.com/proof.jpg'],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-005' } });
    });

    it('happy path：落字段 + 写 OUT_OF_STOCK_REPORTED 事件 + 不取消', async () => {
      mockDb.order.findUnique
        .mockResolvedValueOnce(buildOrder()) // 预读
        .mockResolvedValueOnce(buildOrder()); // 全缺判定重读（单项 qty=3 登记缺 2 → 非全缺）
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem());
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});

      const cancelFn = vi.fn();
      const svc = new OutOfStockService(null, { cancelOrderInternal: cancelFn } as never);
      const result = await svc.adminReportItemOutOfStock('order-1', 'item-1', baseInput);

      expect(mockDb.orderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: expect.objectContaining({ outOfStockQty: 2, outOfStockReason: 'DAMAGED' }),
        }),
      );
      expect(mockDb.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'OUT_OF_STOCK_REPORTED' }),
        }),
      );
      expect(cancelFn).not.toHaveBeenCalled();
      expect(result.orderCancelled).toBe(false);
    });
  });

  describe('全缺判定（D11，仅拣货段）', () => {
    it('整单全部项缺 → cancelOrderInternal(reason=OUT_OF_STOCK) + orderCancelled=true', async () => {
      // 默认返回全缺订单（writeReportEvent 与全缺判定都会 findUnique）
      mockDb.order.findUnique.mockResolvedValue(
        buildOrder({ items: [buildItem({ outOfStockQty: 3 })] }),
      );
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem({ quantity: 3 }));
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});

      const cancelFn = vi.fn().mockResolvedValue(undefined);
      const svc = new OutOfStockService(null, { cancelOrderInternal: cancelFn } as never);
      const result = await svc.adminReportItemOutOfStock('order-1', 'item-1', {
        ...baseInput,
        outOfStockQty: 3,
      });

      expect(cancelFn).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ reason: 'OUT_OF_STOCK' }),
      );
      expect(result.orderCancelled).toBe(true);
    });

    it('多项订单部分项缺 → 不取消', async () => {
      // 预读 + writeReportEvent + 全缺判定（3 次 findUnique：前 2 次带未登记项，第 3 次带已登记项）
      mockDb.order.findUnique
        .mockResolvedValue(buildOrder({ items: [buildItem(), buildItem({ id: 'item-2' })] }))
        .mockResolvedValueOnce(buildOrder({ items: [buildItem(), buildItem({ id: 'item-2' })] })) // 预读
        .mockResolvedValueOnce(buildOrder({ items: [buildItem(), buildItem({ id: 'item-2' })] })) // 事件读状态
        .mockResolvedValueOnce(
          buildOrder({
            items: [buildItem({ outOfStockQty: 3 }), buildItem({ id: 'item-2' })], // item-2 未登记
          }),
        );
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem({ quantity: 3 }));
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});

      const cancelFn = vi.fn();
      const svc = new OutOfStockService(null, { cancelOrderInternal: cancelFn } as never);
      const result = await svc.adminReportItemOutOfStock('order-1', 'item-1', {
        ...baseInput,
        outOfStockQty: 3,
      });
      expect(cancelFn).not.toHaveBeenCalled();
      expect(result.orderCancelled).toBe(false);
    });
  });

  describe('riderReportOutOfStock（D12 骑手段仅部分缺）', () => {
    const riderInput = {
      riderUserId: 'rider-u1',
      outOfStockQty: 1,
      reason: 'DAMAGED' as const,
    };

    it('订单非 OUT_FOR_DELIVERY → E-OOS-001', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder({ status: 'PICKED' }));
      await expect(
        service.riderReportOutOfStock('order-1', riderInput),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-001' } });
    });

    it('骑手段全缺请求（累计缺 ≥ 总量）→ E-OOS-004（D12）', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder({ status: 'OUT_FOR_DELIVERY' }));
      mockDb.orderItem.findMany.mockResolvedValue([buildItem({ quantity: 3 })]);
      await expect(
        service.riderReportOutOfStock('order-1', { ...riderInput, outOfStockQty: 3 }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-004' } });
    });

    it('骑手段部分缺 happy path：落首项 + orderCancelled 恒 false', async () => {
      mockDb.order.findUnique
        .mockResolvedValueOnce(buildOrder({ status: 'OUT_FOR_DELIVERY' })) // 预读
        .mockResolvedValue(buildOrder({ status: 'OUT_FOR_DELIVERY' })); // 事件读状态
      mockDb.orderItem.findMany.mockResolvedValue([
        buildItem(),
        buildItem({ id: 'item-2', quantity: 2 }),
      ]);
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});

      const result = await service.riderReportOutOfStock('order-1', riderInput);
      expect(mockDb.orderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: expect.objectContaining({ outOfStockQty: 1 }),
        }),
      );
      expect(result.orderCancelled).toBe(false);
    });

    it('已有部分登记后本次覆盖剩余全部 → E-OOS-004', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder({ status: 'OUT_FOR_DELIVERY' }));
      mockDb.orderItem.findMany.mockResolvedValue([
        buildItem({ outOfStockQty: 2 }),
        buildItem({ id: 'item-2', quantity: 1 }),
      ]);
      // 累计已缺 2 + 本次 2 ≥ 总量 4 → 拒
      await expect(
        service.riderReportOutOfStock('order-1', { ...riderInput, outOfStockQty: 2 }),
      ).rejects.toMatchObject({ response: { code: 'E-OOS-004' } });
    });
  });

  // ============================================================
  // 批2（D16 同步直推，2026-10-24）：登记事务 commit 后推送 outOfStock 事件
  // A1 硬指标：同步直推（毫秒级），mock 时钟下登记 → notify 调用间隔 < 60_000ms
  // 失败降级：notify 吞错/探针未落库 → 单次补偿重试，两次失败仅告警，不抛错不回滚
  // ============================================================
  describe('批2 同步直推 outOfStock 事件（D16/A1）', () => {
    /** 构造注入 mock notificationEvents 的 service（admin 链第 3 参） */
    const buildSvc = (notifyFn: ReturnType<typeof vi.fn>) =>
      new OutOfStockService(
        null,
        { cancelOrderInternal: vi.fn() } as never,
        { notify: notifyFn } as never,
      );

    const happyAdminMocks = () => {
      mockDb.order.findUnique
        .mockResolvedValueOnce(buildOrder()) // 预读
        .mockResolvedValueOnce(buildOrder()); // 全缺判定重读
      mockDb.orderItem.findUnique.mockResolvedValue(buildItem());
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});
    };

    it('admin 登记 happy path：事务 commit 后同步调 notify（event=outOfStock/CUSTOMER 摘要/data.orderId）', async () => {
      happyAdminMocks();
      mockDb.notification = { findFirst: vi.fn().mockResolvedValue({ id: 'n1' }) };
      const notify = vi.fn().mockResolvedValue(undefined);
      const svc = buildSvc(notify);

      await svc.adminReportItemOutOfStock('order-1', 'item-1', baseInput);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'outOfStock',
          userId: 'u1',
          type: 'ORDER_UPDATE',
          data: expect.objectContaining({ orderId: 'order-1', itemsSummary: expect.any(String) }),
          params: expect.objectContaining({ items: expect.any(String) }),
        }),
      );
    });

    it('rider 登记 happy path：同样触发 outOfStock 推送', async () => {
      mockDb.order.findUnique.mockResolvedValue(buildOrder({ status: 'OUT_FOR_DELIVERY' }));
      mockDb.orderItem.findMany.mockResolvedValue([buildItem(), buildItem({ id: 'item-2' })]);
      mockDb.orderItem.update.mockResolvedValue({});
      mockDb.orderEvent.create.mockResolvedValue({});
      mockDb.notification = { findFirst: vi.fn().mockResolvedValue({ id: 'n1' }) };
      const notify = vi.fn().mockResolvedValue(undefined);
      const svc = buildSvc(notify);

      await svc.riderReportOutOfStock('order-1', {
        riderUserId: 'rider-u1',
        outOfStockQty: 1,
        reason: 'DAMAGED',
      });

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'outOfStock', type: 'ORDER_UPDATE' }),
      );
    });

    it('A1 硬断言：mock 时钟真实参与时间判定——探针时间窗 gte=startedAt，notify 在登记后同一时钟轴上立即发生', async () => {
      vi.useFakeTimers();
      try {
        happyAdminMocks();
        mockDb.orderItem.findUnique.mockResolvedValue(buildItem()); // notifyOutOfStock 品名重读
        const probeCalls: { gte: Date }[] = [];
        mockDb.notification = {
          findFirst: vi.fn().mockImplementation((args: { where: { createdAt: { gte: Date } } }) => {
            probeCalls.push(args.where.createdAt);
            return Promise.resolve({ id: 'n1' });
          }),
        };
        const notify = vi.fn().mockResolvedValue(undefined);
        const svc = buildSvc(notify);

        // mock 时钟锚定 T0：service 内 startedAt = new Date() 即 T0
        vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
        await svc.adminReportItemOutOfStock('order-1', 'item-1', baseInput);

        expect(notify).toHaveBeenCalledTimes(1);
        // P2-2 时间窗实证：探针收到 gte = startedAt（= T0），不是无窗查询
        expect(probeCalls).toHaveLength(1);
        expect(probeCalls[0].gte.getTime()).toBe(new Date('2026-10-24T08:00:00Z').getTime());
        // P3-1 去形式化：mock 时钟真实参与——时钟推进 61s 后再走一遍失败降级链，
        // 若实现改成队列/延迟投递，startedAt 与探针窗口会出现 >60s 时差（A1 违约可测）
        vi.setSystemTime(new Date('2026-10-24T08:01:01Z'));
        // 第二遍：mock 队列已耗尽，重置为持续返回 CONFIRMED 单（order-2，可再登记）
        mockDb.order.findUnique.mockReset().mockResolvedValue(
          buildOrder({ id: 'order-2', items: [buildItem()] }),
        );
        mockDb.orderItem.findUnique.mockReset().mockResolvedValue(buildItem({ id: 'item-1', orderId: 'order-2' }));
        mockDb.orderItem.update.mockReset().mockResolvedValue({});
        mockDb.orderEvent.create.mockReset().mockResolvedValue({});
        mockDb.notification = {
          findFirst: vi.fn().mockImplementation((args: { where: { createdAt: { gte: Date } } }) => {
            probeCalls.push(args.where.createdAt);
            return Promise.resolve({ id: 'n2' });
          }),
        };
        const notify2 = vi.fn().mockResolvedValue(undefined);
        const svc2 = buildSvc(notify2);
        await svc2.adminReportItemOutOfStock('order-2', 'item-1', baseInput);
        expect(notify2).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('P2-2 同单二次登记：探针时间窗命中旧行不成立——本次推送失败仍触发单次补偿', async () => {
      // 场景：同单 item-2 第二次登记（首次登记已落过 data.orderId 相同的 Notification 旧行）
      // 旧实现按 orderId 匹配会命中旧行假阳性；修复后探针加 createdAt >= startedAt 不会命中
      happyAdminMocks();
      const oldRow = { id: 'old-row', createdAt: new Date('2026-10-24T07:00:00Z') }; // 旧行（1 小时前）
      let call = 0;
      mockDb.notification = {
        findFirst: vi.fn().mockImplementation((args: { where: { createdAt?: { gte: Date } } }) => {
          call += 1;
          // 时间窗内（本次登记后）无行 → null（本次推送失败）；若探针错查旧行则返回旧行
          if (args.where.createdAt?.gte) return Promise.resolve(null);
          return Promise.resolve(oldRow);
        }),
      };
      const notify = vi.fn().mockResolvedValue(undefined);
      const svc = buildSvc(notify);

      await svc.adminReportItemOutOfStock('order-1', 'item-2', baseInput);

      // 本次失败仍触发补偿：首次 + 单次补偿 = 恰 2 次（假阳性实现下会是 1 次）
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it('失败降级：首次推送未落库 → 单次补偿重试；两次都失败仅告警不抛错（登记不受影响）', async () => {
      happyAdminMocks();
      // 探针恒 null = Notification 行未落库（推送失败）
      mockDb.notification = { findFirst: vi.fn().mockResolvedValue(null) };
      const notify = vi.fn().mockResolvedValue(undefined);
      const svc = buildSvc(notify);

      const result = await svc.adminReportItemOutOfStock('order-1', 'item-1', baseInput);

      // 首次 + 单次补偿 = 恰 2 次（不无限重试）
      expect(notify).toHaveBeenCalledTimes(2);
      expect(result.orderCancelled).toBe(false);
    });

    it('失败降级：notify 抛错（直调 mock 注入）→ 捕获告警，登记结果照常返回', async () => {
      happyAdminMocks();
      mockDb.notification = { findFirst: vi.fn() };
      const notify = vi.fn().mockRejectedValue(new Error('push provider down'));
      const svc = buildSvc(notify);

      const result = await svc.adminReportItemOutOfStock('order-1', 'item-1', baseInput);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(result.itemId).toBe('item-1');
    });

    it('notificationEvents 未注入（单测直 new 两参）→ 不触发推送不抛错', async () => {
      happyAdminMocks();
      const result = await service.adminReportItemOutOfStock('order-1', 'item-1', baseInput);
      expect(result.orderCancelled).toBe(false);
    });
  });
});
