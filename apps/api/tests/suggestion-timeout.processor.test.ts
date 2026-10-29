/**
 * SuggestionTimeoutProcessor 单测（替换品批1 P2-1/P2-2 修复，2026-10-29）
 *
 * P2-1 缺陷：原实现「探针 + 精确重找」两段查询完全相同（无 metadata.itemId 过滤）
 * 恒返回同一条 = 死代码；同单多行 PENDING 时各行都拿到最近一条登记事件的 createdAt
 *（第一行的登记时间）→ 第二行被提前超时。修复：findFirst 直接按
 * metadata: { path: ['itemId'], equals: itemId } 精确匹配本行自己的登记事件。
 *
 * mock 时钟（vi.useFakeTimers）：两行 PENDING 各自登记时间做基准——
 *   item-A 登记于 25h 前（> 24h 默认时限）→ 过期自动拒绝
 *   item-B 登记于 1h 前（< 24h）→ 未到期不动
 *
 * P2-2：缺登记事件的行 → 告警 + noEventSkipped 计数 + 跳过（绝不误杀）。
 *
 * mock：db（systemConfig/orderItem/orderEvent）+ OrderService.decideSuggestionTimeoutRefund。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDb, mockOrderServiceDecide } = vi.hoisted(() => ({
  mockDb: {
    systemConfig: { findUnique: vi.fn() },
    orderItem: { findMany: vi.fn(), update: vi.fn() },
    orderEvent: { findFirst: vi.fn() },
  },
  mockOrderServiceDecide: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SuggestionTimeoutProcessor } from '../src/modules/order/suggestion-timeout.processor';

function buildPendingItem(id: string, orderId: string) {
  return {
    id,
    orderId,
    order: { status: 'CONFIRMED', deletedAt: null },
  };
}

function makeJob(name = 'expire-stale-suggestions') {
  return { name, data: {} } as never;
}

describe('SuggestionTimeoutProcessor（P2-1/P2-2 修复回归）', () => {
  let processor: SuggestionTimeoutProcessor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T16:00:00Z'));
    vi.clearAllMocks();
    processor = new SuggestionTimeoutProcessor({
      decideSuggestionTimeoutRefund: mockOrderServiceDecide,
    } as never);
    mockDb.systemConfig.findUnique.mockResolvedValue(null); // 无配置 → 默认 24h
    mockDb.orderItem.update.mockResolvedValue({});
    mockOrderServiceDecide.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('两行 PENDING 各用自己登记事件时间做基准：过期行拒绝、未到期行不动（P2-1）', async () => {
    const now = Date.now();
    mockDb.orderItem.findMany.mockResolvedValue([
      buildPendingItem('item-A', 'order-1'),
      buildPendingItem('item-B', 'order-1'),
    ]);
    // item-A 登记于 25h 前（> 24h）→ 过期；item-B 登记于 1h 前 → 未到期。
    // 修复前：两行 findFirst 都拿同一事件（order/orderId 级查询）→ item-B 也被提前拒绝。
    mockDb.orderEvent.findFirst.mockImplementation(async ({ where }: { where: { metadata: { equals: unknown } } }) => {
      const itemId = (where.metadata as { equals: string }).equals;
      if (itemId === 'item-A') return { createdAt: new Date(now - 25 * 3600_000), metadata: {} };
      if (itemId === 'item-B') return { createdAt: new Date(now - 1 * 3600_000), metadata: {} };
      return null;
    });

    const result = await processor.process(makeJob());

    expect(result).toEqual({ expired: 1, dryRun: false });
    // 只有 item-A 被置 DECLINED
    expect(mockDb.orderItem.update).toHaveBeenCalledTimes(1);
    expect(mockDb.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-A' }, data: expect.objectContaining({ suggestionStatus: 'DECLINED' }) }),
    );
    expect(mockOrderServiceDecide).toHaveBeenCalledTimes(1);
    expect(mockOrderServiceDecide).toHaveBeenCalledWith('order-1', 'item-A');
    // 精确匹配断言：findFirst where 必须带 metadata.itemId = 行 id（死代码回归点）
    expect(mockDb.orderEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: 'order-1',
          eventType: 'OUT_OF_STOCK_REPORTED',
          metadata: { path: ['itemId'], equals: 'item-A' },
        }),
      }),
    );
  });

  it('同单多行均过期：各自超时基准独立，全部拒绝', async () => {
    const now = Date.now();
    mockDb.orderItem.findMany.mockResolvedValue([
      buildPendingItem('item-A', 'order-1'),
      buildPendingItem('item-B', 'order-1'),
    ]);
    // 两行分别登记于 30h / 25h 前（都过期）——修复前共用第一行时间也能全过，
    // 但若第二行登记晚于第一行超时点则被误杀；此处用差异时间锁定独立基准语义
    mockDb.orderEvent.findFirst.mockImplementation(async ({ where }: { where: { metadata: { equals: unknown } } }) => {
      const itemId = (where.metadata as { equals: string }).equals;
      return {
        createdAt: new Date(now - (itemId === 'item-A' ? 30 : 25) * 3600_000),
        metadata: {},
      };
    });

    const result = await processor.process(makeJob());
    expect(result.expired).toBe(2);
    expect(mockOrderServiceDecide).toHaveBeenCalledTimes(2);
  });

  it('缺登记事件的行：告警 + 跳过计数，不误杀（P2-2）', async () => {
    mockDb.orderItem.findMany.mockResolvedValue([buildPendingItem('item-C', 'order-2')]);
    mockDb.orderEvent.findFirst.mockResolvedValue(null);

    const result = await processor.process(makeJob());

    expect(result.expired).toBe(0);
    expect(mockDb.orderItem.update).not.toHaveBeenCalled();
    expect(mockOrderServiceDecide).not.toHaveBeenCalled();
    const { logger } = await import('../src/shared/logger/logger');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'SUGGESTION_TIMEOUT_NO_REPORT_EVENT', itemId: 'item-C' }),
    );
  });

  it('未知 job name → 不扫描', async () => {
    const result = await processor.process(makeJob('other-job'));
    expect(result).toEqual({ expired: 0, dryRun: false });
    expect(mockDb.orderItem.findMany).not.toHaveBeenCalled();
  });

  it('dryRun → 跳过扫描', async () => {
    const result = await processor.process({ name: 'expire-stale-suggestions', data: { dryRun: true } } as never);
    expect(result).toEqual({ expired: 0, dryRun: true });
    expect(mockDb.orderItem.findMany).not.toHaveBeenCalled();
  });
});
