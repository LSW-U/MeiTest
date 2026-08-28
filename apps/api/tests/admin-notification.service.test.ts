/**
 * AdminNotificationService 集成单测（admin-web 优化方案 批次2 — P2-2 修复 2026-08-29）
 *
 * 覆盖 resolveTargetUserIds 的两个 e2e 难造分支（e2e 造 50001 用户成本过高）：
 *   - ALL_CUSTOMERS / ALL_RIDERS 群发分支：db.user.findMany role 过滤 → 返 ids
 *   - BROADCAST_HARD_LIMIT=50000 超限抛 E-ADMIN-NOTIF-002（防误操作硬上限）
 *
 * 单测 mock db（不走真实 PG），验业务逻辑分支与错误码，与 e2e（真链路写表）互补。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AdminNotificationService } from '../src/modules/notification/admin-notification.service';

describe('AdminNotificationService - 群发分支 + 超限拦截（P2-2 修复）', () => {
  let service: AdminNotificationService;

  beforeEach(() => {
    vi.resetAllMocks();
    // notifyFactory 传 null：单测聚焦 resolveTargetUserIds + 写表分支，PUSH 通道不强验
    service = new AdminNotificationService(null);
  });

  const mkUserIds = (n: number) => Array.from({ length: n }, (_, i) => `u-${i}`);

  it('ALL_CUSTOMERS 群发：db.user.findMany(role=CUSTOMER) 返 ids → createMany 写表数 = ids 数', async () => {
    const ids = mkUserIds(3);
    mockDb.user.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
    mockDb.notification.createMany.mockResolvedValueOnce({ count: ids.length });

    const result = await service.send({
      target: 'ALL_CUSTOMERS',
      type: 'SYSTEM',
      title: { en: 'Hi all', zh: '', id: '', pt: '' },
      content: { en: 'body', zh: '', id: '', pt: '' },
      data: null,
    });

    // role=CUSTOMER 且 status!=DELETED
    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'CUSTOMER', status: { not: 'DELETED' } },
        select: { id: true },
      }),
    );
    expect(mockDb.notification.createMany).toHaveBeenCalledTimes(1);
    expect(result.deliveredCount).toBe(3);
    // notifyFactory=null → push.success=false, error='NotifyFactory not available'
    expect(result.push.success).toBe(false);
    expect(result.push.error).toBe('NotifyFactory not available');
  });

  it('ALL_RIDERS 群发：role=RIDER 过滤', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'r-1' }, { id: 'r-2' }]);
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 2 });

    await service.send({
      target: 'ALL_RIDERS',
      type: 'ORDER_UPDATE',
      title: { en: 't', zh: '', id: '', pt: '' },
      content: { en: 'c', zh: '', id: '', pt: '' },
      data: null,
    });

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'RIDER', status: { not: 'DELETED' } },
      }),
    );
  });

  it('ALL_CUSTOMERS 群发超 50000 → 抛 E-ADMIN-NOTIF-002，不写表', async () => {
    // 造 50001 个 id（超 BROADCAST_HARD_LIMIT=50000）。mockResolvedValue 复用（多次调用同返）。
    mockDb.user.findMany.mockResolvedValue(mkUserIds(50_001).map((id) => ({ id })));

    let caught: unknown;
    try {
      await service.send({
        target: 'ALL_CUSTOMERS',
        type: 'SYSTEM',
        title: { en: 't', zh: '', id: '', pt: '' },
        content: { en: 'c', zh: '', id: '', pt: '' },
        data: null,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({
      code: 'E-ADMIN-NOTIF-002',
    });
    expect(mockDb.notification.createMany).not.toHaveBeenCalled();
  });

  it('ALL_CUSTOMERS 群发恰好 50000 → 不抛错（边界等于不超限）', async () => {
    const ids = mkUserIds(50_000);
    mockDb.user.findMany.mockResolvedValue(ids.map((id) => ({ id })));
    mockDb.notification.createMany.mockResolvedValue({ count: 50_000 });

    const result = await service.send({
      target: 'ALL_CUSTOMERS',
      type: 'SYSTEM',
      title: { en: 't', zh: '', id: '', pt: '' },
      content: { en: 'c', zh: '', id: '', pt: '' },
      data: null,
    });

    expect(result.deliveredCount).toBe(50_000);
  });

  it('ALL_CUSTOMERS 群发但库内 0 收件人 → 写 0 条，push.error=no recipients', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);

    const result = await service.send({
      target: 'ALL_CUSTOMERS',
      type: 'SYSTEM',
      title: { en: 't', zh: '', id: '', pt: '' },
      content: { en: 'c', zh: '', id: '', pt: '' },
      data: null,
    });

    expect(result.deliveredCount).toBe(0);
    expect(mockDb.notification.createMany).not.toHaveBeenCalled();
    expect(result.push.success).toBe(false);
    expect(result.push.error).toBe('no recipients');
  });
});
