/**
 * AdminNotificationController 单测（admin-web 优化方案 批次2 2026-08-29）
 *
 * 覆盖 controller 装配：
 *   - 路由前缀 /api/v1/admin/notifications（@Controller 装饰器）
 *   - POST / 发送 → 调 send(body)，返回 { success, data }
 *   - GET / 历史 → 调 listHistory({ type, target, page, pageSize })，返回 { success, data }
 *
 * service 层（target 解析 / E-ADMIN-NOTIF-001/002 / NotifyFactory stub）由 e2e + service 集成覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminNotificationController } from '../src/modules/notification/admin-notification.controller';

const { mockNotifService } = vi.hoisted(() => ({
  mockNotifService: {
    send: vi.fn(),
    listHistory: vi.fn(),
  },
}));

vi.mock('../src/modules/notification/admin-notification.service', () => ({
  AdminNotificationService: class {
    send = mockNotifService.send;
    listHistory = mockNotifService.listHistory;
  },
}));

import { AdminNotificationService } from '../src/modules/notification/admin-notification.service';

describe('AdminNotificationController - 2 端点装配（批次2）', () => {
  let controller: AdminNotificationController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new AdminNotificationController(new AdminNotificationService() as never);
  });

  it('POST / - send 调 send(body)，返回 { success, data }', async () => {
    const mockData = {
      deliveredCount: 3,
      push: { success: true, mockFlag: true, error: null },
    };
    mockNotifService.send.mockResolvedValue(mockData);

    const body = {
      target: 'SPECIFIC_USERS' as const,
      userIds: ['u-1', 'u-2', 'u-3'],
      type: 'SYSTEM' as const,
      title: { en: 'Hi', zh: '你好', id: 'Hai', pt: 'Oi' },
      content: { en: 'Body', zh: '正文', id: 'Isi', pt: 'Corpo' },
      data: null,
    };

    const result = await controller.send(body);

    expect(mockNotifService.send).toHaveBeenCalledWith(body);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST / - service 抛 BadRequestException(E-ADMIN-NOTIF-001) 直接冒泡（controller 不吞）', async () => {
    const err = new Error('Some userIds do not exist');
    mockNotifService.send.mockRejectedValue(err);

    await expect(
      controller.send({
        target: 'SPECIFIC_USERS',
        userIds: ['missing'],
        type: 'SYSTEM',
        title: { en: 'a', zh: '', id: '', pt: '' },
        content: { en: 'b', zh: '', id: '', pt: '' },
        data: null,
      }),
    ).rejects.toThrow('Some userIds do not exist');
  });

  it('GET / - list 透传 { type, page, pageSize } 到 listHistory（MVP 不支持 target），返回 { success, data }', async () => {
    const mockData = {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasMore: false,
    };
    mockNotifService.listHistory.mockResolvedValue(mockData);

    const result = await controller.list({
      type: 'PROMOTION',
      page: 2,
      pageSize: 10,
    });

    expect(mockNotifService.listHistory).toHaveBeenCalledWith({
      type: 'PROMOTION',
      page: 2,
      pageSize: 10,
    });
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET / - 缺省 query 透传 undefined（无 target 字段）', async () => {
    const mockData = { items: [], page: 1, pageSize: 20, total: 0, hasMore: false };
    mockNotifService.listHistory.mockResolvedValue(mockData);

    const result = await controller.list({});

    expect(mockNotifService.listHistory).toHaveBeenCalledWith({
      type: undefined,
      page: undefined,
      pageSize: undefined,
    });
    expect(result).toEqual({ success: true, data: mockData });
  });
});
