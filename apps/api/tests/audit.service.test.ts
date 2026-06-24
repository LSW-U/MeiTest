/**
 * AuditService 单测（m6 修复）
 *
 * 重点验证：
 *   - list 分页：cursor 空 / 非空 / 末页
 *   - list orderBy 复合排序（M5 修复：createdAt + id）
 *   - exportCsv：CSV 格式 + BOM（m2 修复）+ escape 特殊字符
 *   - detail 不存在 → E-AUDIT-001
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../src/shared/db', () => ({
  db: {
    auditLog: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { AuditService, MAX_EXPORT_ROWS } from '../src/modules/platform/audit.service';
import { db } from '../src/shared/db';

const dbMock = db as unknown as {
  auditLog: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuditService();
  });

  describe('list', () => {
    it('无 cursor → take limit+1，不带 cursor/skip', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const result = await service.list({
        limit: 10,
        userId: undefined,
        action: undefined,
        resourceType: undefined,
        from: undefined,
        to: undefined,
        perspective: undefined,
        cursor: undefined,
      } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.take).toBe(11);
      expect(arg.cursor).toBeUndefined();
      expect(arg.skip).toBeUndefined();
      expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(result.items).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('带 cursor → cursor: { id }, skip: 1', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([{ id: 'c' }]);

      await service.list({
        limit: 10,
        cursor: 'prev-cursor',
      } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.cursor).toEqual({ id: 'prev-cursor' });
      expect(arg.skip).toBe(1);
    });

    it('返回数量 > limit → hasMore=true，nextCursor=最后一条 id', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' }, // 第 3 条表示 hasMore
      ]);

      const result = await service.list({ limit: 2 } as never);

      expect(result.hasMore).toBe(true);
      expect(result.items).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(result.nextCursor).toBe('b');
    });

    it('filter userId 透传到 where', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      await service.list({ limit: 10, userId: 'user-1' } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.where.userId).toBe('user-1');
    });
  });

  describe('detail', () => {
    it('存在 → 返回记录', async () => {
      dbMock.auditLog.findUnique.mockResolvedValue({ id: 'a', action: 'X' });

      const result = await service.detail('a');
      expect(result).toEqual({ id: 'a', action: 'X' });
    });

    it('不存在 → NotFoundException + E-AUDIT-001', async () => {
      dbMock.auditLog.findUnique.mockResolvedValue(null);

      await expect(service.detail('missing')).rejects.toThrow(NotFoundException);
      try {
        await service.detail('missing');
      } catch (e) {
        const resp = (e as NotFoundException).getResponse() as { code: string };
        expect(resp.code).toBe('E-AUDIT-001');
      }
    });
  });

  describe('exportCsv', () => {
    it('开头加 UTF-8 BOM（m2 修复）', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      const csv = await service.exportCsv({ limit: 100 } as never);

      expect(csv.startsWith('﻿')).toBe(true);
    });

    it('headers 顺序固定 + 第一行是 headers', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      const csv = await service.exportCsv({ limit: 100 } as never);

      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        '﻿id,createdAt,userId,action,resourceType,resourceId,perspective,deviceType,ip,traceId',
      );
    });

    it('包含特殊字符的字段 → 双引号包裹 + 内部双引号转义为 ""', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([
        {
          id: 'uuid-1',
          createdAt: new Date('2026-06-23T10:00:00Z'),
          userId: 'user-1',
          action: 'UPDATE_WITH_COMMA,AND_QUOTE"AND_NEWLINE\n',
          resourceType: 'SystemConfig',
          resourceId: 'key,with,commas',
          perspective: 'platform',
          deviceType: 'ADMIN_WEB',
          ip: '1.1.1.1',
          traceId: 'trace-1',
        },
      ]);

      const csv = await service.exportCsv({ limit: 100 } as never);

      // 含逗号/双引号/换行的字段必须被 escape
      expect(csv).toContain('"UPDATE_WITH_COMMA,AND_QUOTE""AND_NEWLINE\n"');
      expect(csv).toContain('"key,with,commas"');
    });

    it(`take = MAX_EXPORT_ROWS = ${10000}`, async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      await service.exportCsv({ limit: 100 } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.take).toBe(MAX_EXPORT_ROWS);
      expect(arg.take).toBe(10000);
      // exportCsv 也用复合排序（M5）
      expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });
  });

  describe('buildWhere（通过 list 间接测）', () => {
    it('from/to 都给 → createdAt: { gte, lt }', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      await service.list({
        limit: 10,
        from: '2026-06-01',
        to: '2026-06-30',
      } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.where.createdAt.gte).toEqual(new Date('2026-06-01'));
      expect(arg.where.createdAt.lt).toEqual(new Date('2026-06-30'));
    });

    it('只给 action → action: { contains }（模糊匹配）', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      await service.list({ limit: 10, action: 'UPDATE' } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.where.action).toEqual({ contains: 'UPDATE' });
    });

    it('perspective → where.perspective（精确匹配）', async () => {
      dbMock.auditLog.findMany.mockResolvedValue([]);

      await service.list({ limit: 10, perspective: 'platform' } as never);

      const arg = dbMock.auditLog.findMany.mock.calls[0][0];
      expect(arg.where.perspective).toBe('platform');
    });
  });
});
