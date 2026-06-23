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
});
