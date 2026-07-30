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
