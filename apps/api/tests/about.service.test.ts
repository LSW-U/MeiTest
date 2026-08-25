/**
 * AboutService 单测（P25 #2，2026-08-25）
 *
 * 覆盖：
 *   - getProfile: 正常路径（cache miss → 并行查 stats + socials → 回填缓存）
 *   - getProfile: cache hit → 直接返回缓存，不打 DB
 *   - getProfile: cache 损坏（非 JSON）→ 重建
 *   - loadSocials: host 白名单放行（wa.me / facebook.com / instagram.com）
 *   - loadSocials: 非法项静默丢弃（type 非法 / url 非法 / host 不在白名单）
 *   - P2-4 修复：key 未 seed / 非 JSON / 非数组 → socials 降级 []，stats 正常下发（不抛 404）
 *
 * Mock：db（prisma 单例）+ redis（shared/cache 单例）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 的 factory 必须先于 import 被求值（hoist），用变量占位
vi.mock('../src/shared/db', () => ({
  db: {
    warehouse: { count: vi.fn() },
    shop: { count: vi.fn() },
    order: { count: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock('../src/shared/cache', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { AboutService } from '../src/modules/about/about.service';
import { db } from '../src/shared/db';
import { redis } from '../src/shared/cache';

const dbMock = db as unknown as {
  warehouse: { count: ReturnType<typeof vi.fn> };
  shop: { count: ReturnType<typeof vi.fn> };
  order: { count: ReturnType<typeof vi.fn> };
  systemConfig: { findUnique: ReturnType<typeof vi.fn> };
};

const redisMock = redis as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

/** 构造合法 socials SystemConfig value（JSON 字符串） */
function socialsValue(items: Array<{ type: string; url: string }>): string {
  return JSON.stringify(items);
}

describe('AboutService.getProfile - P25 #2 关于页可配置数据下发', () => {
  let service: AboutService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AboutService();
    // 默认 cache miss
    redisMock.get.mockResolvedValue(null);
    // 默认 stats 计数
    dbMock.warehouse.count.mockResolvedValue(3);
    dbMock.shop.count.mockResolvedValue(1);
    dbMock.order.count.mockResolvedValue(5000);
  });

  it('cache miss → 并行查 stats + socials → 回填缓存', async () => {
    dbMock.systemConfig.findUnique.mockResolvedValue({
      key: 'about.socials',
      value: socialsValue([
        { type: 'whatsapp', url: 'https://wa.me/67077000000' },
        { type: 'facebook', url: 'https://facebook.com/meimart' },
        { type: 'instagram', url: 'https://instagram.com/meimart' },
      ]),
    });

    const data = await service.getProfile();

    expect(data.stats).toEqual({ regions: 3, merchants: 1, orders: 5000 });
    expect(data.socials).toHaveLength(3);
    expect(data.socials[0]).toEqual({ type: 'whatsapp', url: 'https://wa.me/67077000000' });
    // 三个 count + 一次 socials 读 = 并行；findUnique 调用一次
    expect(dbMock.warehouse.count).toHaveBeenCalledTimes(1);
    expect(dbMock.shop.count).toHaveBeenCalledTimes(1);
    expect(dbMock.order.count).toHaveBeenCalledTimes(1);
    expect(dbMock.systemConfig.findUnique).toHaveBeenCalledWith({ where: { key: 'about.socials' } });
    // 回填缓存（含 TTL 3600）
    expect(redisMock.set).toHaveBeenCalledWith(
      'AboutProfile',
      expect.any(String),
      'EX',
      3600,
    );
  });

  it('cache hit → 直接返回缓存，不打 DB', async () => {
    const cached = {
      stats: { regions: 9, merchants: 5, orders: 99999 },
      socials: [{ type: 'whatsapp', url: 'https://wa.me/67077000000' }],
    };
    redisMock.get.mockResolvedValue(JSON.stringify(cached));

    const data = await service.getProfile();

    expect(data.stats).toEqual(cached.stats);
    expect(data.socials).toEqual(cached.socials);
    expect(dbMock.warehouse.count).not.toHaveBeenCalled();
    expect(dbMock.systemConfig.findUnique).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('cache 损坏（非 JSON）→ 忽略缓存，重建并回填', async () => {
    redisMock.get.mockResolvedValue('{not valid json');
    dbMock.systemConfig.findUnique.mockResolvedValue({
      key: 'about.socials',
      value: socialsValue([{ type: 'whatsapp', url: 'https://wa.me/67077000000' }]),
    });

    const data = await service.getProfile();

    expect(data.stats).toEqual({ regions: 3, merchants: 1, orders: 5000 });
    expect(redisMock.set).toHaveBeenCalledTimes(1);
  });
});

describe('AboutService.loadSocials - socials 校验', () => {
  let service: AboutService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AboutService();
    redisMock.get.mockResolvedValue(null);
    dbMock.warehouse.count.mockResolvedValue(0);
    dbMock.shop.count.mockResolvedValue(0);
    dbMock.order.count.mockResolvedValue(0);
  });

  it('host 白名单放行：wa.me / facebook.com / instagram.com', async () => {
    dbMock.systemConfig.findUnique.mockResolvedValue({
      key: 'about.socials',
      value: socialsValue([
        { type: 'whatsapp', url: 'https://wa.me/67077000000' },
        { type: 'facebook', url: 'https://www.facebook.com/meimart' },
        { type: 'instagram', url: 'https://instagram.com/meimart' },
      ]),
    });

    const data = await service.getProfile();
    expect(data.socials.map((s) => s.type)).toEqual(['whatsapp', 'facebook', 'instagram']);
  });

  it('非法项静默丢弃：type 非法 / url 非法 / host 不在白名单', async () => {
    dbMock.systemConfig.findUnique.mockResolvedValue({
      key: 'about.socials',
      value: socialsValue([
        { type: 'twitter', url: 'https://twitter.com/x' }, // type 非法
        { type: 'whatsapp', url: 'not-a-url' }, // url 非法
        { type: 'whatsapp', url: 'https://evil.com/x' }, // host 不在白名单
        { type: 'instagram', url: 'https://instagram.com/meimart' }, // 合法 → 保留
      ]),
    });

    const data = await service.getProfile();
    expect(data.socials).toEqual([
      { type: 'instagram', url: 'https://instagram.com/meimart' },
    ]);
  });

  it('P2-4 修复：socials key 未 seed → socials 降级 []，stats 正常下发（不抛 404）', async () => {
    dbMock.systemConfig.findUnique.mockResolvedValue(null);

    const data = await service.getProfile();
    expect(data.stats).toEqual({ regions: 0, merchants: 0, orders: 0 });
    expect(data.socials).toEqual([]);
  });

  it('P2-4 修复：socials value 非 JSON → socials 降级 []，stats 正常下发', async () => {
    dbMock.systemConfig.findUnique.mockResolvedValue({
      key: 'about.socials',
      value: 'not json at all',
    });

    const data = await service.getProfile();
    expect(data.stats).toEqual({ regions: 0, merchants: 0, orders: 0 });
    expect(data.socials).toEqual([]);
  });

  it('P2-4 修复：socials value 非 JSON 数组（如对象）→ socials 降级 []', async () => {
    dbMock.systemConfig.findUnique.mockResolvedValue({
      key: 'about.socials',
      value: JSON.stringify({ type: 'whatsapp', url: 'https://wa.me/1' }),
    });

    const data = await service.getProfile();
    expect(data.socials).toEqual([]);
  });
});
