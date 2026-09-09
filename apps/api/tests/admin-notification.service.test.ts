/**
 * AdminNotificationService 集成单测（admin-web 优化方案 批次2 — P2-2 修复 2026-08-29）
 *
 * 批A A5 批次化更新（2026-09-09）：
 *   - send 现在先写 NotificationBatch 行，再首块同步投递 + 剩余分块入队（无队列时降级同步）
 *   - listHistory 改批次行（target/totalRecipients/deliveredCount/failedCount 真实值 +
 *     readCount 实时聚合 count(batchId, isRead=true)）
 *   - retry 仅重发 failed 用户（批次无行用户），返回 retriedCount/deliveredCount/failedCount
 *
 * 覆盖 resolveTargetUserIds 的两个 e2e 难造分支（e2e 造 50001 用户成本过高）：
 *   - ALL_CUSTOMERS / ALL_RIDERS 群发分支：db.user.findMany role 过滤 → 返 ids
 *   - BROADCAST_HARD_LIMIT=50000 超限抛 E-ADMIN-NOTIF-002（防误操作硬上限）
 *
 * 单测 mock db（不走真实 PG），验业务逻辑分支与错误码，与 e2e（真链路写表）互补。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    deviceToken: { findMany: vi.fn() },
    notificationBatch: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
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
    // notificationQueue 传 null：无队列降级同步投递（分块语义可全同步验证）
    service = new AdminNotificationService(null, null);
    // 审查 P2-2：sendPushToUser 会查 deviceToken；默认无 token（pushFailed=0 不污染计数断言）
    mockDb.deviceToken.findMany.mockResolvedValue([]);
  });

  const mkUserIds = (n: number) => Array.from({ length: n }, (_, i) => `u-${i}`);

  function mockBatchCreate() {
    mockDb.notificationBatch.create.mockResolvedValueOnce({
      id: 'batch-1',
      type: 'SYSTEM',
      target: 'ALL_CUSTOMERS',
      totalRecipients: 0,
      deliveredCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    });
  }

  it('ALL_CUSTOMERS 群发：写 Batch 行 + createMany 写表数 = ids 数（≤100 单块全同步）', async () => {
    const ids = mkUserIds(3);
    mockDb.user.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
    mockBatchCreate();
    mockDb.notification.createMany.mockResolvedValueOnce({ count: ids.length });
    mockDb.notificationBatch.update.mockResolvedValueOnce({});

    const result = await service.send(
      {
        target: 'ALL_CUSTOMERS',
        type: 'SYSTEM',
        title: { en: 'Hi all', zh: '', id: '', pt: '' },
        content: { en: 'body', zh: '', id: '', pt: '' },
        data: null,
      },
      'admin-1',
    );

    // role=CUSTOMER 且 status!=DELETED
    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'CUSTOMER', status: { not: 'DELETED' } },
        select: { id: true },
      }),
    );
    // 批次行先落（totalRecipients=3）
    expect(mockDb.notificationBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalRecipients: 3, createdBy: 'admin-1', target: 'ALL_CUSTOMERS' }),
      }),
    );
    expect(mockDb.notification.createMany).toHaveBeenCalledTimes(1);
    expect(result.batchId).toBe('batch-1');
    expect(result.totalRecipients).toBe(3);
    expect(result.deliveredCount).toBe(3);
    // notifyFactory=null → push.success=false, error='NotifyFactory not available'
    expect(result.push.success).toBe(false);
    expect(result.push.error).toBe('NotifyFactory not available');
  });

  it('ALL_RIDERS 群发：role=RIDER 过滤', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'r-1' }, { id: 'r-2' }]);
    mockBatchCreate();
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 2 });
    mockDb.notificationBatch.update.mockResolvedValueOnce({});

    await service.send(
      {
        target: 'ALL_RIDERS',
        type: 'ORDER_UPDATE',
        title: { en: 't', zh: '', id: '', pt: '' },
        content: { en: 'c', zh: '', id: '', pt: '' },
        data: null,
      },
      'admin-1',
    );

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
      await service.send(
        {
          target: 'ALL_CUSTOMERS',
          type: 'SYSTEM',
          title: { en: 't', zh: '', id: '', pt: '' },
          content: { en: 'c', zh: '', id: '', pt: '' },
          data: null,
        },
        'admin-1',
      );
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
    mockBatchCreate();
    // 首块 100
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 100 });
    mockDb.notificationBatch.update.mockResolvedValue({});
    // 无队列降级同步：剩 499 块
    mockDb.notification.createMany.mockResolvedValue({ count: 100 });

    const result = await service.send(
      {
        target: 'ALL_CUSTOMERS',
        type: 'SYSTEM',
        title: { en: 't', zh: '', id: '', pt: '' },
        content: { en: 'c', zh: '', id: '', pt: '' },
        data: null,
      },
      'admin-1',
    );

    // 首块同步 100 + 剩余 499 块同步（无队列降级）
    expect(mockDb.notification.createMany).toHaveBeenCalledTimes(500);
    expect(result.deliveredCount).toBe(100); // 响应只报首块
    expect(result.totalRecipients).toBe(50_000);
  });

  it('ALL_CUSTOMERS 群发但库内 0 收件人 → 批次 0 人落行，push.error=no recipients', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockBatchCreate();

    const result = await service.send(
      {
        target: 'ALL_CUSTOMERS',
        type: 'SYSTEM',
        title: { en: 't', zh: '', id: '', pt: '' },
        content: { en: 'c', zh: '', id: '', pt: '' },
        data: null,
      },
      'admin-1',
    );

    expect(result.deliveredCount).toBe(0);
    expect(result.totalRecipients).toBe(0);
    expect(mockDb.notification.createMany).not.toHaveBeenCalled();
    expect(result.push.success).toBe(false);
    expect(result.push.error).toBe('no recipients');
  });
});

// ===== 批A A5：批次历史 + retry =====
describe('AdminNotificationService - A5 批次历史 + retry', () => {
  let service: AdminNotificationService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AdminNotificationService(null, null);
    // 审查 P2-2：sendPushToUser 会查 deviceToken；默认无 token（pushFailed=0）
    mockDb.deviceToken.findMany.mockResolvedValue([]);
  });

  it('listHistory：批次行 + readCount 实时聚合 count(batchId, isRead=true)', async () => {
    mockDb.notificationBatch.findMany.mockResolvedValueOnce([
      {
        id: 'batch-1',
        type: 'PROMOTION',
        target: 'ALL_CUSTOMERS',
        totalRecipients: 1200,
        deliveredCount: 1150,
        failedCount: 50,
        title: { en: 'promo' },
        content: { en: 'body' },
        createdAt: new Date('2026-09-09T00:00:00Z'),
      },
    ]);
    mockDb.notificationBatch.count.mockResolvedValueOnce(1);
    mockDb.notification.count.mockResolvedValueOnce(890);

    const result = await service.listHistory({});

    expect(mockDb.notificationBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
    expect(mockDb.notification.count).toHaveBeenCalledWith({
      where: { batchId: 'batch-1', isRead: true },
    });
    expect(result.items[0]).toEqual({
      id: 'batch-1',
      type: 'PROMOTION',
      target: 'ALL_CUSTOMERS',
      totalRecipients: 1200,
      deliveredCount: 1150,
      failedCount: 50,
      readCount: 890,
      title: { en: 'promo' },
      content: { en: 'body' },
      createdAt: '2026-09-09T00:00:00.000Z',
    });
  });

  it('listHistory：type 筛选透传到批次查询', async () => {
    mockDb.notificationBatch.findMany.mockResolvedValueOnce([]);
    mockDb.notificationBatch.count.mockResolvedValueOnce(0);

    await service.listHistory({ type: 'PROMOTION' });

    expect(mockDb.notificationBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'PROMOTION' } }),
    );
  });

  it('retry：批次不存在 → E-ADMIN-NOTIF-003', async () => {
    mockDb.notificationBatch.findUnique.mockResolvedValueOnce(null);

    await expect(service.retry('missing-batch')).rejects.toThrow(NotFoundException);
  });

  it('retry：全部已投递（无 failed）→ retriedCount=0，不改计数', async () => {
    mockDb.notificationBatch.findUnique.mockResolvedValueOnce({
      id: 'batch-1',
      type: 'SYSTEM',
      target: 'ALL_CUSTOMERS',
      totalRecipients: 2,
      deliveredCount: 2,
      failedCount: 0,
      title: { en: 't' },
      content: { en: 'c' },
      createdAt: new Date(),
    });
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'u-1' }, { id: 'u-2' }]);
    // 已有行 = 全部用户
    mockDb.notification.findMany.mockResolvedValueOnce([{ userId: 'u-1' }, { userId: 'u-2' }]);
    mockDb.notification.count.mockResolvedValueOnce(2);

    const result = await service.retry('batch-1');

    expect(result.retriedCount).toBe(0);
    expect(result.deliveredCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(mockDb.notification.createMany).not.toHaveBeenCalled();
  });

  it('retry：仅重发 failed（无行）用户 → deliverChunk 重写行 + 校正批次计数', async () => {
    mockDb.notificationBatch.findUnique.mockResolvedValueOnce({
      id: 'batch-1',
      type: 'SYSTEM',
      target: 'ALL_CUSTOMERS',
      totalRecipients: 3,
      deliveredCount: 1,
      failedCount: 2,
      title: { en: 't' },
      content: { en: 'c' },
      createdAt: new Date(),
    });
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'u-1' }, { id: 'u-2' }, { id: 'u-3' }]);
    // 已有行只有 u-1 → failed = u-2, u-3
    mockDb.notification.findMany.mockResolvedValueOnce([{ userId: 'u-1' }]);
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 2 });
    mockDb.notificationBatch.update.mockResolvedValue({});
    // 重试后重算：总数 = 3 行
    mockDb.notification.count.mockResolvedValueOnce(3);

    const result = await service.retry('batch-1');

    expect(mockDb.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 'u-2', batchId: 'batch-1' }),
        expect.objectContaining({ userId: 'u-3', batchId: 'batch-1' }),
      ]),
    });
    expect(result.retriedCount).toBe(2);
    expect(result.deliveredCount).toBe(3);
    expect(result.failedCount).toBe(0);
    // 计数校正写回
    expect(mockDb.notificationBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-1' },
        data: expect.objectContaining({ deliveredCount: 3, failedCount: 0 }),
      }),
    );
  });

  // ===== 审查 P2-1：SPECIFIC_USERS 快照列方案 =====

  it('retry SPECIFIC_USERS：从 userIds 快照恢复全集 → 差集重发（不调 user.findMany）', async () => {
    mockDb.notificationBatch.findUnique.mockResolvedValueOnce({
      id: 'batch-spec-1',
      type: 'PROMOTION',
      target: 'SPECIFIC_USERS',
      userIds: ['u-1', 'u-2', 'u-3'], // 快照列（审查 P2-1 裁决）
      totalRecipients: 3,
      deliveredCount: 1,
      failedCount: 2,
      title: { en: 't' },
      content: { en: 'c' },
      createdAt: new Date(),
    });
    // 已有行只有 u-1 → failed = u-2, u-3
    mockDb.notification.findMany.mockResolvedValueOnce([{ userId: 'u-1' }]);
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 2 });
    mockDb.notificationBatch.update.mockResolvedValue({});
    mockDb.notification.count.mockResolvedValueOnce(3);

    const result = await service.retry('batch-spec-1');

    // 快照恢复全集，不按 target 重新解析（user.findMany 不被调用）
    expect(mockDb.user.findMany).not.toHaveBeenCalled();
    expect(mockDb.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 'u-2', batchId: 'batch-spec-1' }),
        expect.objectContaining({ userId: 'u-3', batchId: 'batch-spec-1' }),
      ]),
    });
    expect(result.retriedCount).toBe(2);
    expect(result.deliveredCount).toBe(3);
    expect(result.failedCount).toBe(0);
  });

  it('retry SPECIFIC_USERS：快照缺失（历史数据）→ E-ADMIN-NOTIF-004 明确报错', async () => {
    mockDb.notificationBatch.findUnique.mockResolvedValueOnce({
      id: 'batch-spec-2',
      type: 'PROMOTION',
      target: 'SPECIFIC_USERS',
      userIds: null, // 快照缺失
      totalRecipients: 5,
      deliveredCount: 0,
      failedCount: 5,
      title: { en: 't' },
      content: { en: 'c' },
      createdAt: new Date(),
    });

    let caught: unknown;
    try {
      await service.retry('batch-spec-2');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({
      code: 'E-ADMIN-NOTIF-004',
    });
    expect(mockDb.notification.createMany).not.toHaveBeenCalled();
  });

  it('send SPECIFIC_USERS：批次行落 userIds 快照（审查 P2-1）', async () => {
    const ids = ['u-1', 'u-2'];
    // SPECIFIC_USERS 走存在性校验分支
    mockDb.user.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
    mockDb.notificationBatch.create.mockResolvedValueOnce({
      id: 'batch-spec-3',
      type: 'SYSTEM',
      target: 'SPECIFIC_USERS',
      totalRecipients: 2,
      deliveredCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    });
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 2 });
    mockDb.notificationBatch.update.mockResolvedValue({});

    await service.send(
      {
        target: 'SPECIFIC_USERS',
        userIds: ids,
        type: 'SYSTEM',
        title: { en: 't', zh: '', id: '', pt: '' },
        content: { en: 'c', zh: '', id: '', pt: '' },
        data: null,
      },
      'admin-1',
    );

    expect(mockDb.notificationBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target: 'SPECIFIC_USERS',
          userIds: ['u-1', 'u-2'], // 快照列落库
          totalRecipients: 2,
        }),
      }),
    );
  });

  it('send ALL_CUSTOMERS：批次行 userIds 快照为 null（群发动态集合不快照）', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'u-1' }]);
    mockDb.notificationBatch.create.mockResolvedValueOnce({
      id: 'batch-all-1',
      type: 'SYSTEM',
      target: 'ALL_CUSTOMERS',
      totalRecipients: 1,
      deliveredCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    });
    mockDb.notification.createMany.mockResolvedValueOnce({ count: 1 });
    mockDb.notificationBatch.update.mockResolvedValue({});

    await service.send(
      {
        target: 'ALL_CUSTOMERS',
        type: 'SYSTEM',
        title: { en: 't', zh: '', id: '', pt: '' },
        content: { en: 'c', zh: '', id: '', pt: '' },
        data: null,
      },
      'admin-1',
    );

    expect(mockDb.notificationBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ target: 'ALL_CUSTOMERS', userIds: null }),
      }),
    );
  });
});
