/**
 * SystemConfigService 单测：cache-aside 读写策略
 *
 * Mock db.systemConfig + redis，验证：
 *   - get：先查 redis，命中则不查 db；miss 时查 db 回填
 *   - update：DB 更新成功后立即 del 缓存
 *   - update 不存在的 key → NotFoundException + E-PLATFORM-002
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../src/shared/db', () => ({
  db: {
    systemConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/cache', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SystemConfigService } from '../src/modules/platform/system-config.service';
import { db } from '../src/shared/db';
import { redis } from '../src/shared/cache';

const dbMock = db.systemConfig as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const redisMock = redis as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
};

describe('SystemConfigService', () => {
  let service: SystemConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SystemConfigService();
  });

  it('get: redis 命中 → 不查 db', async () => {
    redisMock.get.mockResolvedValueOnce('5');
    const v = await service.get('platform.commission_rate');
    expect(v).toBe('5');
    expect(redisMock.get).toHaveBeenCalledWith('SystemConfig:platform.commission_rate');
    expect(dbMock.findUnique).not.toHaveBeenCalled();
  });

  it('get: redis miss → 查 db 并回填缓存', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    dbMock.findUnique.mockResolvedValueOnce({ key: 'k', value: '7', description: null });
    redisMock.set.mockResolvedValueOnce('OK');

    const v = await service.get('k');

    expect(v).toBe('7');
    expect(dbMock.findUnique).toHaveBeenCalledWith({ where: { key: 'k' } });
    expect(redisMock.set).toHaveBeenCalledWith(
      'SystemConfig:k',
      '7',
      'EX',
      300,
    );
  });

  it('get: db 也 miss → 返回 null（不写缓存）', async () => {
    redisMock.get.mockResolvedValueOnce(null);
    dbMock.findUnique.mockResolvedValueOnce(null);

    const v = await service.get('missing');
    expect(v).toBeNull();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('update: DB 更新后立即 del 缓存', async () => {
    dbMock.findUnique.mockResolvedValueOnce({ key: 'k', value: 'old' });
    dbMock.update.mockResolvedValueOnce({
      key: 'k',
      value: 'new',
      description: 'desc',
      updatedAt: new Date('2026-06-23T10:00:00Z'),
      updatedBy: 'user-1',
    });
    redisMock.del.mockResolvedValueOnce(1);

    const dto = await service.update('k', 'new', 'desc', 'user-1');

    expect(dto.value).toBe('new');
    expect(dbMock.update).toHaveBeenCalledWith({
      where: { key: 'k' },
      data: { value: 'new', description: 'desc', updatedBy: 'user-1' },
    });
    expect(redisMock.del).toHaveBeenCalledWith('SystemConfig:k');
  });

  it('P1-3 修复：update about.socials 时一并 del 派生缓存 AboutProfile', async () => {
    dbMock.findUnique.mockResolvedValueOnce({ key: 'about.socials', value: 'old' });
    dbMock.update.mockResolvedValueOnce({
      key: 'about.socials',
      value: 'new',
      description: 'desc',
      updatedAt: new Date('2026-06-23T10:00:00Z'),
      updatedBy: 'user-1',
    });
    redisMock.del.mockResolvedValueOnce(1);

    await service.update('about.socials', 'new', 'desc', 'user-1');

    // 先 del 自身 SystemConfig 缓存，再 del 派生 AboutProfile
    expect(redisMock.del).toHaveBeenCalledWith('SystemConfig:about.socials');
    expect(redisMock.del).toHaveBeenCalledWith('AboutProfile');
  });

  it('P1-3 修复：update 非 about. 的 key 不动 AboutProfile', async () => {
    dbMock.findUnique.mockResolvedValueOnce({ key: 'support.phone', value: 'old' });
    dbMock.update.mockResolvedValueOnce({
      key: 'support.phone',
      value: 'new',
      description: 'desc',
      updatedAt: new Date(),
      updatedBy: 'u',
    });
    redisMock.del.mockResolvedValueOnce(1);

    await service.update('support.phone', 'new', 'desc', 'u');

    expect(redisMock.del).toHaveBeenCalledWith('SystemConfig:support.phone');
    expect(redisMock.del).not.toHaveBeenCalledWith('AboutProfile');
  });

  it('update: key 不存在 → NotFoundException + E-PLATFORM-002', async () => {
    dbMock.findUnique.mockResolvedValueOnce(null);
    await expect(service.update('missing', 'x', undefined, 'u')).rejects.toThrow(
      NotFoundException,
    );
    try {
      await service.update('missing', 'x', undefined, 'u');
    } catch (e) {
      const exc = e as NotFoundException;
      const resp = exc.getResponse() as { code: string };
      expect(resp.code).toBe('E-PLATFORM-002');
    }
  });

  it('update: description === undefined 时不覆盖 description', async () => {
    dbMock.findUnique.mockResolvedValueOnce({ key: 'k', value: 'old' });
    dbMock.update.mockResolvedValueOnce({
      key: 'k',
      value: 'new',
      description: 'old-desc',
      updatedAt: new Date(),
      updatedBy: 'u',
    });
    redisMock.del.mockResolvedValueOnce(1);

    await service.update('k', 'new', undefined, 'u');

    expect(dbMock.update).toHaveBeenCalledWith({
      where: { key: 'k' },
      data: { value: 'new', updatedBy: 'u' },
    });
  });

  // ===== 批A P3-3（2026-09-10）：weights 版本 bump 正向断言 =====
  // 此前 redis mock 缺 incr，update('dispatch.score_weights') 走 bumpKeys 循环时
  // "redis.incr is not a function" 被 try/catch 吞成 warn——测试绿但属异常路径过关。
  it('批A P3-3: update dispatch.score_weights → INCR 权重版本号（不 DEL 版本键）', async () => {
    dbMock.findUnique.mockResolvedValueOnce({ key: 'dispatch.score_weights', value: 'old' });
    dbMock.update.mockResolvedValueOnce({
      key: 'dispatch.score_weights',
      value: 'new',
      description: null,
      updatedAt: new Date(),
      updatedBy: 'admin-1',
    });
    redisMock.del.mockResolvedValue(1);
    redisMock.incr.mockResolvedValue(1);

    await service.update('dispatch.score_weights', 'new', undefined, 'admin-1');

    // 自身缓存 del 照常；weights 的派生 cacheKey 为空串（filter 掉）不 del 空键
    expect(redisMock.del).toHaveBeenCalledWith('SystemConfig:dispatch.score_weights');
    expect(redisMock.del).not.toHaveBeenCalledWith('');
    // 版本号 INCR（读者进程 getScoreWeights 比对版本变化才回源）
    expect(redisMock.incr).toHaveBeenCalledTimes(1);
    expect(redisMock.incr).toHaveBeenCalledWith('config:dispatch:weights:ver');
  });

  it('批A P3-3: update 无 bumpVerKey 的 key → incr 不被调', async () => {
    dbMock.findUnique.mockResolvedValueOnce({ key: 'support.phone', value: 'old' });
    dbMock.update.mockResolvedValueOnce({
      key: 'support.phone',
      value: 'new',
      description: null,
      updatedAt: new Date(),
      updatedBy: 'u',
    });
    redisMock.del.mockResolvedValue(1);

    await service.update('support.phone', 'new', undefined, 'u');

    expect(redisMock.incr).not.toHaveBeenCalled();
  });
});
