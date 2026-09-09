/**
 * NotificationEventService 单测（批A A4，2026-09-09）
 *
 * 覆盖：
 *   - notify：写 Notification 行 + PUSH（按 DeviceToken.locale 逐设备发）
 *   - 失败容忍：站内信写失败 / PUSH 查询失败 → logger.warn，不抛错（不炸业务主流程）
 *   - renderTemplate：五语言渲染 + {placeholder} 插值 + tet 走 en 兜底
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockNotifyFactory } = vi.hoisted(() => ({
  mockDb: {
    notification: {
      create: vi.fn(),
    },
    deviceToken: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockNotifyFactory: {
    sendMulti: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NotificationEventService } from '../src/modules/notification/notification-event.service';

describe('NotificationEventService', () => {
  let service: NotificationEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new NotificationEventService(mockNotifyFactory);
  });

  it('notify：写 Notification 行（五语言 title/content + data）+ 按 token.locale 发 PUSH', async () => {
    mockDb.notification.create.mockResolvedValueOnce({ id: 'n1' });
    mockDb.deviceToken.findMany.mockResolvedValueOnce([
      { token: 'expo-tok-zh', locale: 'zh' },
      { token: 'expo-tok-en', locale: 'en' },
    ]);
    mockNotifyFactory.sendMulti.mockResolvedValue({ PUSH: { success: true, mockFlag: false } });

    await service.notify({
      event: 'orderConfirmed',
      userId: 'user-1',
      type: 'ORDER_UPDATE',
      data: { orderId: 'order-1', orderNo: 'MM1' },
      params: { orderNo: 'MM1' },
    });

    // 站内信：五语言 title/content + data 落行
    expect(mockDb.notification.create).toHaveBeenCalledTimes(1);
    const created = mockDb.notification.create.mock.calls[0][0];
    expect(created.data.userId).toBe('user-1');
    expect(created.data.type).toBe('ORDER_UPDATE');
    expect(created.data.title.en).toBe('Order Confirmed');
    expect(created.data.title.zh).toBe('订单已确认');
    expect(created.data.data).toEqual({ orderId: 'order-1', orderNo: 'MM1' });

    // PUSH：逐 token 发，locale pick 单语言对象
    expect(mockDb.deviceToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'ACTIVE' } }),
    );
    expect(mockNotifyFactory.sendMulti).toHaveBeenCalledTimes(2);
    expect(mockNotifyFactory.sendMulti).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'user-1',
        title: { zh: '订单已确认' },
        locale: 'zh',
      }),
      ['PUSH'],
    );
    expect(mockNotifyFactory.sendMulti).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'user-1',
        title: { en: 'Order Confirmed' },
        locale: 'en',
      }),
      ['PUSH'],
    );
  });

  it('失败容忍：notification.create 抛错 → logger.warn 不抛（主流程安全）', async () => {
    mockDb.notification.create.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.notify({
        event: 'orderCancelled',
        userId: 'user-1',
        type: 'ORDER_UPDATE',
        data: { orderId: 'order-1' },
        params: { orderNo: 'MM1' },
      }),
    ).resolves.toBeUndefined();

    // PUSH 不再继续（站内信失败已捕获返回）
    expect(mockNotifyFactory.sendMulti).not.toHaveBeenCalled();
  });

  it('失败容忍：PUSH token 查询抛错 → logger.warn 不抛（站内信已落）', async () => {
    mockDb.notification.create.mockResolvedValueOnce({ id: 'n1' });
    mockDb.deviceToken.findMany.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service.notify({
        event: 'taskAssigned',
        userId: 'rider-1',
        type: 'RIDER_TASK',
        data: { taskId: 't1' },
      }),
    ).resolves.toBeUndefined();

    expect(mockDb.notification.create).toHaveBeenCalledTimes(1);
  });

  it('无 ACTIVE token → 仅站内信，不调 PUSH', async () => {
    mockDb.notification.create.mockResolvedValueOnce({ id: 'n1' });
    mockDb.deviceToken.findMany.mockResolvedValueOnce([]);

    await service.notify({
      event: 'withdrawReviewed',
      userId: 'rider-1',
      type: 'WALLET',
      data: { withdrawId: 'w1', status: 'APPROVED' },
      params: { withdrawId: 'w1', status: 'approved' },
    });

    expect(mockDb.notification.create).toHaveBeenCalledTimes(1);
    expect(mockNotifyFactory.sendMulti).not.toHaveBeenCalled();
  });

  it('renderTemplate：{placeholder} 插值 + tet 走 en 兜底', async () => {
    const rendered = service.renderTemplate('orderConfirmed', { orderNo: 'MM2026090900001' });

    expect(rendered.title.en).toBe('Order Confirmed');
    expect(rendered.content.en).toContain('MM2026090900001');
    expect(rendered.content.en).not.toContain('{orderNo}');
    // tet 占位与 en 同值
    expect(rendered.title.tet).toBe(rendered.title.en);
    // 5 语言全覆盖
    expect(Object.keys(rendered.title).sort()).toEqual(['en', 'id', 'pt', 'tet', 'zh']);
  });
});

// ===== 批A A2：Expo Push token 失效联动 =====
describe('NotificationEventService - A2 token 失效联动', () => {
  let service: NotificationEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new NotificationEventService(mockNotifyFactory);
  });

  it('PUSH 返回 invalid:<token> 标记 → DeviceToken 置 INVALID', async () => {
    mockDb.notification.create.mockResolvedValueOnce({ id: 'n1' });
    mockDb.deviceToken.findMany.mockResolvedValueOnce([
      { token: 'expo-dead-token', locale: 'en' },
    ]);
    mockNotifyFactory.sendMulti.mockResolvedValueOnce({
      PUSH: { success: false, messageId: 'invalid:expo-dead-token', error: 'NotRegistered', mockFlag: false },
    });

    await service.notify({
      event: 'orderConfirmed',
      userId: 'user-1',
      type: 'ORDER_UPDATE',
      params: { orderNo: 'MM1' },
    });

    expect(mockDb.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'expo-dead-token' },
      data: { status: 'INVALID' },
    });
  });

  it('PUSH 普通 success → 不动 token 状态', async () => {
    mockDb.notification.create.mockResolvedValueOnce({ id: 'n1' });
    mockDb.deviceToken.findMany.mockResolvedValueOnce([
      { token: 'expo-live-token', locale: 'en' },
    ]);
    mockNotifyFactory.sendMulti.mockResolvedValueOnce({
      PUSH: { success: true, messageId: 'expo-msg-1', mockFlag: false },
    });

    await service.notify({
      event: 'orderDelivered',
      userId: 'user-1',
      type: 'ORDER_UPDATE',
      params: { orderNo: 'MM1' },
    });

    expect(mockDb.deviceToken.updateMany).not.toHaveBeenCalled();
  });
});
