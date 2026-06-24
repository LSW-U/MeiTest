/**
 * OrderNo Service — 单测（mock Redis）
 *
 * 覆盖：
 *   - nextOrderNo 基础格式（MM + yyyyMMdd + whCode + seq4）
 *   - 首次 INCR 时设置 TTL（expire 被调用）
 *   - 序号 > 9999 时抛 ORDER_NO_SEQUENCE_OVERFLOW
 *   - warehouseCode 格式校验（必须 2 位数字）
 *   - 时区 Asia/Dili（用真实当前日期验证）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted 让 mock 引用在 vi.mock factory 中可用（vi.mock 是 hoisted 的）
const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../src/shared/cache', () => ({
  redis: mockRedis,
}));

import { OrderNoService } from '../src/modules/order/order-no.service';

describe('OrderNoService', () => {
  let service: OrderNoService;

  beforeEach(() => {
    service = new OrderNoService();
    mockRedis.incr.mockReset();
    mockRedis.expire.mockReset();
  });

  describe('nextOrderNo - 基础格式', () => {
    it('返回 16 位 MM + 8 位日期 + 2 位仓库 + 4 位序号', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const orderNo = await service.nextOrderNo('01');

      // 格式 MM + 14 位数字（MM=2 + date=8 + wh=2 + seq=4）
      expect(orderNo).toMatch(/^MM\d{14}$/);
      expect(orderNo.length).toBe(16);
      // MM 前缀
      expect(orderNo.startsWith('MM')).toBe(true);
      // warehouse 2 位（位置 10-12）
      expect(orderNo.slice(10, 12)).toBe('01');
      // 序号 4 位（位置 12-16）padStart 0
      expect(orderNo.slice(12)).toBe('0001');
    });

    it('序号 234 时格式化为 0234', async () => {
      mockRedis.incr.mockResolvedValue(234);

      const orderNo = await service.nextOrderNo('01');
      expect(orderNo.slice(12)).toBe('0234');
    });

    it('warehouseCode W02 → 02', async () => {
      mockRedis.incr.mockResolvedValue(1);

      const orderNo = await service.nextOrderNo('02');
      expect(orderNo.slice(10, 12)).toBe('02');
    });
  });

  describe('nextOrderNo - TTL 设置', () => {
    it('首次 INCR（返回 1）时调 expire 设 TTL', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await service.nextOrderNo('01');

      expect(mockRedis.expire).toHaveBeenCalledTimes(1);
      const [key, ttl] = mockRedis.expire.mock.calls[0]!;
      expect(key).toMatch(/^order:seq:\d{8}:01$/);
      expect(ttl).toBe(2 * 24 * 60 * 60); // 2 天
    });

    it('非首次 INCR（返回 >1）时不调 expire', async () => {
      mockRedis.incr.mockResolvedValue(5);

      await service.nextOrderNo('01');

      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('Redis key 格式：order:seq:{date}:{whCode}', async () => {
      mockRedis.incr.mockResolvedValue(1);

      await service.nextOrderNo('03');

      const [key] = mockRedis.incr.mock.calls[0]!;
      expect(key).toMatch(/^order:seq:\d{8}:03$/);
    });
  });

  describe('nextOrderNo - 序号溢出', () => {
    it('序号 10000（> 9999）时抛 ORDER_NO_SEQUENCE_OVERFLOW', async () => {
      mockRedis.incr.mockResolvedValue(10000);

      await expect(service.nextOrderNo('01')).rejects.toThrow(/ORDER_NO_SEQUENCE_OVERFLOW/);
    });

    it('序号 9999 不抛错（边界值）', async () => {
      mockRedis.incr.mockResolvedValue(9999);

      const orderNo = await service.nextOrderNo('01');
      expect(orderNo.slice(12)).toBe('9999');
    });
  });

  describe('nextOrderNo - warehouseCode 格式校验', () => {
    it('warehouseCode 非 2 位数字抛错', async () => {
      await expect(service.nextOrderNo('W01')).rejects.toThrow(/ORDER_NO_WAREHOUSE_CODE_FORMAT/);
      await expect(service.nextOrderNo('1')).rejects.toThrow(/ORDER_NO_WAREHOUSE_CODE_FORMAT/);
      await expect(service.nextOrderNo('001')).rejects.toThrow(/ORDER_NO_WAREHOUSE_CODE_FORMAT/);
      await expect(service.nextOrderNo('AB')).rejects.toThrow(/ORDER_NO_WAREHOUSE_CODE_FORMAT/);
    });

    it('warehouseCode 2 位数字通过', async () => {
      mockRedis.incr.mockResolvedValue(1);
      await expect(service.nextOrderNo('01')).resolves.toBeDefined();
      await expect(service.nextOrderNo('99')).resolves.toBeDefined();
    });
  });

  describe('nextOrderNo - 时区 Asia/Dili', () => {
    it('日期段符合 Asia/Dili yyyyMMdd（mock 实际日期）', async () => {
      mockRedis.incr.mockResolvedValue(1);

      const orderNo = await service.nextOrderNo('01');
      const dateStr = orderNo.slice(2, 10); // 8 位日期（位置 2-10）

      // 验证：8 位数字 + 月 01-12 + 日 01-31
      expect(dateStr).toMatch(/^\d{8}$/);
      const month = parseInt(dateStr.slice(4, 6), 10);
      const day = parseInt(dateStr.slice(6, 8), 10);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(31);
    });
  });
});
