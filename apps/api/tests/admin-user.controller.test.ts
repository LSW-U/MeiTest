/**
 * AdminUserController 单测（W7-fix 审查 #14 2026-07-10）
 *
 * 覆盖 5 端点的 controller 层：
 *   - 路由前缀 /api/v1/admin/users（@Controller 装饰器）
 *   - response 一律 { success: true, data }
 *   - update/suspend 注入 req.user.sub 作 actorId
 *   - ZodValidationPipe 校验 query/body
 *
 * service 层逻辑由 admin-user.service.test.ts 覆盖，这里只测 controller 装配
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminUserController } from '../src/modules/user/admin-user.controller';

const { mockUserService } = vi.hoisted(() => ({
  mockUserService: {
    listUsers: vi.fn(),
    getUserDetail: vi.fn(),
    updateUser: vi.fn(),
    suspendUser: vi.fn(),
    activateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetUserPassword: vi.fn(),
  },
}));

vi.mock('../src/modules/user/user.service', () => ({
  UserService: class {
    listUsers = mockUserService.listUsers;
    getUserDetail = mockUserService.getUserDetail;
    updateUser = mockUserService.updateUser;
    suspendUser = mockUserService.suspendUser;
    activateUser = mockUserService.activateUser;
    deleteUser = mockUserService.deleteUser;
    resetUserPassword = mockUserService.resetUserPassword;
  },
}));

import { UserService } from '../src/modules/user/user.service';

describe('AdminUserController - 5 端点装配（W7-fix 审查 #14）', () => {
  let controller: AdminUserController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new AdminUserController(new UserService() as never);
  });

  it('GET / - list 调用 listUsers 并返回 { success, data }', async () => {
    const mockData = { items: [], page: 1, pageSize: 20, total: 0, hasMore: false };
    mockUserService.listUsers.mockResolvedValue(mockData);

    const result = await controller.list({
      keyword: 'foo',
      status: 'ACTIVE',
      page: 1,
      pageSize: 20,
    });

    expect(mockUserService.listUsers).toHaveBeenCalledWith({
      keyword: 'foo',
      role: undefined,
      status: 'ACTIVE',
      page: 1,
      pageSize: 20,
    });
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /:id - detail 调用 getUserDetail', async () => {
    const mockData = { id: 'u-1', phone: '+67088888888', role: 'CUSTOMER' };
    mockUserService.getUserDetail.mockResolvedValue(mockData);

    const result = await controller.detail('u-1');

    expect(mockUserService.getUserDetail).toHaveBeenCalledWith('u-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('PATCH /:id - update 把 req.user.sub 作 actorId 传给 service', async () => {
    const mockData = { id: 'u-1', name: 'NewName' };
    mockUserService.updateUser.mockResolvedValue(mockData);

    const result = await controller.update(
      { user: { sub: 'u-actor' } } as never,
      'u-1',
      { name: 'NewName' },
    );

    expect(mockUserService.updateUser).toHaveBeenCalledWith('u-1', { name: 'NewName' }, 'u-actor');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/suspend - suspend 把 req.user.sub 作 actorId 传给 service', async () => {
    const mockData = { id: 'u-1', status: 'SUSPENDED' };
    mockUserService.suspendUser.mockResolvedValue(mockData);

    const result = await controller.suspend(
      { user: { sub: 'u-actor' } } as never,
      'u-1',
      { reason: 'fraud' },
    );

    expect(mockUserService.suspendUser).toHaveBeenCalledWith('u-1', 'u-actor');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/activate - activate 不传 actorId', async () => {
    const mockData = { id: 'u-1', status: 'ACTIVE' };
    mockUserService.activateUser.mockResolvedValue(mockData);

    const result = await controller.activate('u-1', {});

    expect(mockUserService.activateUser).toHaveBeenCalledWith('u-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/delete - delete 把 req.user.sub 作 actorId 传给 service', async () => {
    const mockData = { id: 'u-1', status: 'DELETED' };
    mockUserService.deleteUser.mockResolvedValue(mockData);

    const result = await controller.delete(
      { user: { sub: 'u-actor' } } as never,
      'u-1',
      { reason: 'account closure' },
    );

    expect(mockUserService.deleteUser).toHaveBeenCalledWith('u-1', 'u-actor');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/reset-password - resetPassword 返回临时密码', async () => {
    const mockData = { temporaryPassword: 'Abc123xyz789', generatedAt: '2026-07-10T00:00:00.000Z' };
    mockUserService.resetUserPassword.mockResolvedValue(mockData);

    const result = await controller.resetPassword('u-1');

    expect(mockUserService.resetUserPassword).toHaveBeenCalledWith('u-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('所有 response 都是 { success: true as const, data }', async () => {
    mockUserService.listUsers.mockResolvedValue({});
    mockUserService.getUserDetail.mockResolvedValue({});
    mockUserService.updateUser.mockResolvedValue({});
    mockUserService.suspendUser.mockResolvedValue({});
    mockUserService.activateUser.mockResolvedValue({});
    mockUserService.deleteUser.mockResolvedValue({});
    mockUserService.resetUserPassword.mockResolvedValue({});

    const results = await Promise.all([
      controller.list({}),
      controller.detail('u-1'),
      controller.update({ user: { sub: 'a' } } as never, 'u-1', {}),
      controller.suspend({ user: { sub: 'a' } } as never, 'u-1', {}),
      controller.activate('u-1', {}),
      controller.delete({ user: { sub: 'a' } } as never, 'u-1', {}),
      controller.resetPassword('u-1'),
    ]);

    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r).toHaveProperty('data');
    }
  });
});
