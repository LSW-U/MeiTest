/**
 * DeviceTokenService + NotificationService（A1/A3 部分）单测（批A，2026-09-09）
 *
 * 覆盖（任务书验收 A1 幂等 + A3 rider 端点底层）：
 *   - register：create（新 token）/ update（重注册幂等，复位 ACTIVE + lastSeenAt）
 *   - unregister：删自己 token / 删他人 token（deleteMany userId 条件隔离）
 *   - listNotifications / getUnreadCount：偏好过滤（rider 端点复用同一 service）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    deviceToken: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DeviceTokenService } from '../src/modules/notification/device-token.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('DeviceTokenService（批A A1）', () => {
  let service: DeviceTokenService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new DeviceTokenService();
  });

  it('register 新 token → upsert create 分支（status=ACTIVE）', async () => {
    mockDb.deviceToken.upsert.mockResolvedValueOnce({
      id: 'dt-1',
      platform: 'ANDROID',
      locale: 'en',
      status: 'ACTIVE',
      lastSeenAt: new Date('2026-09-09T00:00:00Z'),
    });

    const result = await service.register('user-1', {
      token: 'ExponentPushToken[abc]',
      platform: 'ANDROID',
      locale: 'en',
    });

    expect(mockDb.deviceToken.upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]' },
      create: {
        userId: 'user-1',
        token: 'ExponentPushToken[abc]',
        platform: 'ANDROID',
        locale: 'en',
        status: 'ACTIVE',
      },
      update: {
        userId: 'user-1',
        platform: 'ANDROID',
        locale: 'en',
        status: 'ACTIVE',
        lastSeenAt: expect.any(Date),
      },
    });
    expect(result.id).toBe('dt-1');
    expect(result.status).toBe('ACTIVE');
  });

  it('register 重注册同 token → update 分支（换账号归属切换 + lastSeenAt 刷新，幂等不建重复行）', async () => {
    mockDb.deviceToken.upsert.mockResolvedValueOnce({
      id: 'dt-1',
      platform: 'IOS',
      locale: 'zh',
      status: 'ACTIVE',
      lastSeenAt: new Date(),
    });

    await service.register('user-2', {
      token: 'ExponentPushToken[abc]',
      platform: 'IOS',
      locale: 'zh',
    });

    const arg = mockDb.deviceToken.upsert.mock.calls[0][0];
    expect(arg.where.token).toBe('ExponentPushToken[abc]'); // upsert by token（幂等键）
    expect(arg.update.userId).toBe('user-2');
  });

  it('unregister 删自己 token → deleteMany 带 userId 归属校验', async () => {
    mockDb.deviceToken.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.unregister('user-1', { token: 'tok-1' });

    expect(mockDb.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: { token: 'tok-1', userId: 'user-1' },
    });
    expect(result.success).toBe(true);
  });

  it('unregister token 不存在/他人 token → 幂等返回 success（不抛错）', async () => {
    mockDb.deviceToken.deleteMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.unregister('user-1', { token: 'someone-elses' });

    expect(result.success).toBe(true);
  });
});

describe('NotificationService（批A A3：client/rider 共用底层）', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new NotificationService();
  });

  it('listNotifications 偏好过滤 + riderTasks/wallet 默认 true（rider 端点复用）', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ notificationPreferences: null });
    mockDb.notification.findMany.mockResolvedValueOnce([
      {
        id: 'n1',
        userId: 'rider-1',
        type: 'RIDER_TASK',
        title: { en: 'Task' },
        content: { en: 'New task' },
        isRead: false,
        data: { taskId: 't1' },
        createdAt: new Date('2026-09-09T00:00:00Z'),
      },
    ]);

    const items = await service.listNotifications('rider-1');

    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'rider-1',
          deletedAt: null, // P26 批B1：软删通知对 client/rider 侧不可见
          type: { in: ['ORDER_UPDATE', 'PROMOTION', 'SYSTEM', 'RIDER_TASK', 'WALLET'] },
        },
        take: 100,
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].createdAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('markNotificationRead 不存在 → E-USER-007（client/rider 同错误码）', async () => {
    mockDb.notification.findFirst.mockResolvedValueOnce(null);

    await expect(service.markNotificationRead('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ============================================================================
// P26 批B1（2026-10-13）：通知删除（软删）
// ============================================================================
describe('NotificationService.deleteNotification / deleteNotifications (P26 批B1)', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new NotificationService();
  });

  it('归属校验：非本人/不存在 → 404 E-USER-007', async () => {
    mockDb.notification.findFirst.mockResolvedValueOnce(null);
    await expect(service.deleteNotification('user-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('软删生效：置 deletedAt=Date（不物理删）', async () => {
    mockDb.notification.findFirst.mockResolvedValueOnce({ id: 'n1', userId: 'user-1' });
    mockDb.notification.update.mockResolvedValueOnce({ id: 'n1' });
    const result = await service.deleteNotification('user-1', 'n1');
    expect(result.success).toBe(true);
    expect(mockDb.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('批量：空数组 → 400', async () => {
    await expect(service.deleteNotifications('user-1', [])).rejects.toThrow(BadRequestException);
  });

  it('批量：上限 100 → 400', async () => {
    await expect(service.deleteNotifications('user-1', new Array(101).fill('id'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('批量：updateMany 限定本人 userId（软删）', async () => {
    mockDb.notification.updateMany.mockResolvedValueOnce({ count: 2 });
    const result = await service.deleteNotifications('user-1', ['n1', 'n2']);
    expect(result.success).toBe(true);
    expect(mockDb.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1', 'n2'] }, userId: 'user-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('list 过滤软删通知（deletedAt IS NULL）', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ notificationPreferences: null });
    mockDb.notification.findMany.mockResolvedValueOnce([]);
    await service.listNotifications('user-1');
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it('unread-count 过滤软删通知', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ notificationPreferences: null });
    mockDb.notification.count.mockResolvedValueOnce(0);
    await service.getUnreadCount('user-1');
    expect(mockDb.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});
