/**
 * Search Service 测试 - 热搜（路线 B：Redis ZSET + SearchLog 审计 + 运营种子词）
 *
 * 覆盖：
 * - recordSearch：normalize（Milk/milk/ milk 同词）+ 防刷 dedupe + 空词不记 + slice 50 + 零结果词
 * - listHot：PINNED 前置 + BLOCKED 剔除 + ZSET 真实 + MANUAL 兜底 + lang 过滤 + limit
 * - admin CRUD：createTerm normalize + updateTerm/deleteTerm NotFound + listZeroResult 聚合
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  searchLogCreate: vi.fn(),
  searchLogGroupBy: vi.fn(),
  hotSearchTermFindMany: vi.fn(),
  hotSearchTermFindUnique: vi.fn(),
  hotSearchTermCreate: vi.fn(),
  hotSearchTermUpdate: vi.fn(),
  hotSearchTermDelete: vi.fn(),
  queryRaw: vi.fn(),
  redisSet: vi.fn(),
  redisZincrby: vi.fn(),
  redisZrevrange: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    searchLog: { create: m.searchLogCreate, groupBy: m.searchLogGroupBy },
    hotSearchTerm: {
      findMany: m.hotSearchTermFindMany,
      findUnique: m.hotSearchTermFindUnique,
      create: m.hotSearchTermCreate,
      update: m.hotSearchTermUpdate,
      delete: m.hotSearchTermDelete,
    },
    $queryRaw: m.queryRaw,
  },
}));

vi.mock('../src/shared/cache/redis', () => ({
  redis: { set: m.redisSet, zincrby: m.redisZincrby, zrevrange: m.redisZrevrange },
}));

import { SearchService } from '../src/modules/search/search.service';

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    service = new SearchService();
    vi.clearAllMocks();
  });

  describe('recordSearch', () => {
    it('normalize: Milk/milk/ milk 同一词（trim+lowerCase）', async () => {
      m.redisSet.mockResolvedValue('OK');
      await service.recordSearch(' Milk ', 'en', null, 5, '1.2.3.4');
      await service.recordSearch('milk', 'en', null, 5, '1.2.3.4');
      await service.recordSearch(' Milk', 'en', null, 5, '1.2.3.4');
      expect(m.searchLogCreate).toHaveBeenCalledTimes(3);
      m.searchLogCreate.mock.calls.forEach(([arg]) => {
        expect(arg.data.word).toBe('milk');
      });
      expect(m.redisZincrby).toHaveBeenCalledTimes(3);
      m.redisZincrby.mock.calls.forEach(([key, inc, word]) => {
        expect(key).toBe('hotsearch:en');
        expect(inc).toBe(1);
        expect(word).toBe('milk');
      });
    });

    it('防刷: 10s 内同 user+word 只记一次（redis.set NX 返 null 不记）', async () => {
      m.redisSet.mockResolvedValue(null); // 已存在，去重
      await service.recordSearch('milk', 'en', 'user1', 5, null);
      expect(m.searchLogCreate).not.toHaveBeenCalled();
      expect(m.redisZincrby).not.toHaveBeenCalled();
    });

    it('空词不记', async () => {
      m.redisSet.mockResolvedValue('OK');
      await service.recordSearch('   ', 'en', null, 5, '1.2.3.4');
      expect(m.searchLogCreate).not.toHaveBeenCalled();
      expect(m.redisZincrby).not.toHaveBeenCalled();
    });

    it('word 超 50 字符 slice', async () => {
      m.redisSet.mockResolvedValue('OK');
      await service.recordSearch('a'.repeat(60), 'en', null, 0, null);
      expect(m.searchLogCreate.mock.calls[0][0].data.word).toHaveLength(50);
    });

    it('零结果词也记（resultCount=0，运营补商品依据）', async () => {
      m.redisSet.mockResolvedValue('OK');
      await service.recordSearch('rareresult', 'en', null, 0, null);
      expect(m.searchLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ word: 'rareresult', resultCount: 0 }),
        }),
      );
    });

    it('不支持的语言不记', async () => {
      m.redisSet.mockResolvedValue('OK');
      await service.recordSearch('milk', 'fr', null, 5, null);
      expect(m.searchLogCreate).not.toHaveBeenCalled();
    });
  });

  describe('listHot', () => {
    it('PINNED 前置 + BLOCKED 剔除 + ZSET 真实 + MANUAL 兜底', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([
        { word: 'pinned1', type: 'PINNED', sortOrder: 2 },
        { word: 'pinned2', type: 'PINNED', sortOrder: 1 },
        { word: 'badword', type: 'BLOCKED', sortOrder: 0 },
        { word: 'manual1', type: 'MANUAL', sortOrder: 0 },
      ]);
      // ZSET 真实词（badword 应剔除，pinned1 去重）
      m.redisZrevrange.mockResolvedValue(['badword', '100', 'apple', '50', 'pinned1', '30']);

      const result = await service.listHot('en', 4);
      const words = result.map((r) => r.word);
      expect(words).toEqual(['pinned2', 'pinned1', 'apple', 'manual1']);
      expect(words).not.toContain('badword'); // BLOCKED 剔除
      // searchCount：pinned1 在 ZSET（30），apple 在 ZSET（50），pinned2/manual1 不在（0）
      const map = new Map(result.map((r) => [r.word, r.searchCount]));
      expect(map.get('pinned1')).toBe(30);
      expect(map.get('apple')).toBe(50);
      expect(map.get('pinned2')).toBe(0);
    });

    it('lang 过滤：ZSET key 按 lang', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue(['苹果', '10']);
      await service.listHot('zh', 6);
      expect(m.redisZrevrange.mock.calls[0][0]).toBe('hotsearch:zh');
    });

    it('空 ZSET + 无运营词 -> 返 []', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue([]);
      const result = await service.listHot('en', 6);
      expect(result).toEqual([]);
    });

    it('limit 生效', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue(['a', '1', 'b', '2', 'c', '3', 'd', '4', 'e', '5']);
      const result = await service.listHot('en', 3);
      expect(result).toHaveLength(3);
    });

    it('不支持 lang fallback en', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue([]);
      await service.listHot('fr', 6);
      expect(m.redisZrevrange.mock.calls[0][0]).toBe('hotsearch:en');
    });
  });

  describe('suggest', () => {
    it('prefix < 1 字符 / 纯空格返空（不查 DB）', async () => {
      expect(await service.suggest('', 'en', 8)).toEqual([]);
      expect(await service.suggest('   ', 'en', 8)).toEqual([]);
      expect(m.hotSearchTermFindMany).not.toHaveBeenCalled();
    });

    it('三源合并去重（词库 > ZSET > 商品名，searchCount 取 ZSET 真实值）', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([
        { word: 'apple', type: 'PINNED', sortOrder: 1 },
        { word: 'apple watch', type: 'MANUAL', sortOrder: 0 },
      ]);
      // ZSET：apple 已在词库（去重），application 新词
      m.redisZrevrange.mockResolvedValue(['apple', '100', 'application', '30']);
      // 商品名兜底（raw ILIKE 前缀匹配 ACTIVE 商品名）
      m.queryRaw.mockResolvedValue([{ name: { en: 'Apple Fuji' } }]);

      const result = await service.suggest('app', 'en', 8);
      const words = result.map((r) => r.word);
      // 顺序：词库 PINNED apple / 词库 MANUAL apple watch / ZSET application / 商品名 Apple Fuji
      expect(words).toEqual(['apple', 'apple watch', 'application', 'Apple Fuji']);
      const map = new Map(result.map((r) => [r.word, r.searchCount]));
      expect(map.get('apple')).toBe(100); // 词库 + ZSET 真实值
      expect(map.get('application')).toBe(30);
      expect(map.get('Apple Fuji')).toBe(0); // 商品名兜底无热度
    });

    it('BLOCKED 词从 ZSET + 商品名全链路剔除（运营屏蔽意图）', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([
        { word: 'badword', type: 'BLOCKED', sortOrder: 0 },
        { word: 'badminton', type: 'PINNED', sortOrder: 0 },
      ]);
      // ZSET 含 badword（用户搜过但运营已屏蔽）+ badminton 合法
      m.redisZrevrange.mockResolvedValue(['badword', '999', 'badminton', '50']);
      // 商品名也含 'badword'（exact，key 命中 blocked set）+ Badminton Racket（合法）
      m.queryRaw.mockResolvedValue([
        { name: { en: 'badword' } },
        { name: { en: 'Badminton Racket' } },
      ]);

      const result = await service.suggest('bad', 'en', 8);
      const words = result.map((r) => r.word);
      expect(words).not.toContain('badword'); // ZSET 999 分也被剔除
      expect(words).not.toContain('badword'); // 商品名 exact badword 也被剔除
      expect(words).toContain('badminton');
      expect(words).toContain('Badminton Racket'); // 不同 key，保留
    });

    it('PINNED 优先于 MANUAL（同前缀 PINNED 排前）', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([
        { word: 'apple manual', type: 'MANUAL', sortOrder: 0 },
        { word: 'apple pinned', type: 'PINNED', sortOrder: 5 },
      ]);
      m.redisZrevrange.mockResolvedValue([]);
      m.queryRaw.mockResolvedValue([]);

      const result = await service.suggest('apple', 'en', 8);
      // PINNED 优先（即使 sortOrder 5 > MANUAL 0）
      expect(result.map((r) => r.word)).toEqual(['apple pinned', 'apple manual']);
    });

    it('limit 截断', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue([
        'a1', '1', 'a2', '2', 'a3', '3', 'a4', '4', 'a5', '5',
      ]);
      m.queryRaw.mockResolvedValue([]);
      const result = await service.suggest('a', 'en', 3);
      expect(result).toHaveLength(3);
    });

    it('limit 上限 20（超限 clamp，LIMIT 参数 = 20）', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue([]);
      m.queryRaw.mockResolvedValue([]);
      await service.suggest('a', 'en', 999);
      // $queryRaw tagged template: [strings, safeLang, pattern, pattern, safeLimit]
      // safeLimit 是最后一个参数（SQL 末尾 LIMIT ${safeLimit}），Math.min(Math.max(999,1),20)=20
      const args = m.queryRaw.mock.calls[0];
      expect(args[args.length - 1]).toBe(20);
    });

    it('Redis 离线降级（zrevrange reject，词库 + 商品名仍工作）', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([
        { word: 'apple', type: 'PINNED', sortOrder: 0 },
      ]);
      m.redisZrevrange.mockRejectedValue(new Error('ECONNREFUSED'));
      m.queryRaw.mockResolvedValue([{ name: { en: 'Apple Fuji' } }]);

      const result = await service.suggest('app', 'en', 8);
      const words = result.map((r) => r.word);
      expect(words).toContain('apple'); // 词库仍工作
      expect(words).toContain('Apple Fuji'); // 商品名仍工作
      const map = new Map(result.map((r) => [r.word, r.searchCount]));
      expect(map.get('apple')).toBe(0); // ZSET 拿不到，词库 searchCount=0
    });

    it('不支持 lang fallback en', async () => {
      m.hotSearchTermFindMany.mockResolvedValue([]);
      m.redisZrevrange.mockResolvedValue([]);
      m.queryRaw.mockResolvedValue([]);
      await service.suggest('a', 'fr', 8);
      expect(m.redisZrevrange.mock.calls[0][0]).toBe('hotsearch:en');
    });
  });

  describe('admin CRUD', () => {
    it('createTerm normalize word', async () => {
      m.hotSearchTermCreate.mockResolvedValue({ id: '1' });
      await service.createTerm({ word: ' Milk ', lang: 'en', type: 'PINNED' });
      expect(m.hotSearchTermCreate.mock.calls[0][0].data.word).toBe('milk');
    });

    it('updateTerm 不存在 -> NotFound', async () => {
      m.hotSearchTermFindUnique.mockResolvedValue(null);
      await expect(service.updateTerm('x', { word: 'a' })).rejects.toThrow(NotFoundException);
    });

    it('deleteTerm 不存在 -> NotFound', async () => {
      m.hotSearchTermFindUnique.mockResolvedValue(null);
      await expect(service.deleteTerm('x')).rejects.toThrow(NotFoundException);
    });

    it('listZeroResult 聚合（按 count desc）', async () => {
      m.searchLogGroupBy.mockResolvedValue([
        { word: 'rareresult', lang: 'en', _count: { id: 5 } },
        { word: '缺货', lang: 'zh', _count: { id: 3 } },
      ]);
      const result = await service.listZeroResult();
      expect(result).toEqual([
        { word: 'rareresult', lang: 'en', count: 5 },
        { word: '缺货', lang: 'zh', count: 3 },
      ]);
    });
  });
});
