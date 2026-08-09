/**
 * AdminDispatchController 单测（批次 4，2026-08-10）
 *
 * 覆盖 controller 层装配（参考 admin-user.controller.test.ts + admin-payment.controller.test.ts）：
 *   - list / detail / availableRiders / recreate 装配（调 service + 返回 { success, data }）
 *   - reassign / cancel 把 req.user.sub 作 adminUserId 透传给 service
 *   - reassign / cancel req.user 缺失 → E-AUTH-002（service 不调）
 *
 * service 层事务编排（reassign/cancel 的 withTransaction + 乐观锁）由 dispatch.service.admin.test.ts 覆盖
 *
 * mock：DispatchService class（方法 = mock fn）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminDispatchController } from '../src/modules/dispatch/admin-dispatch.controller';

const { mockDispatchService } = vi.hoisted(() => ({
  mockDispatchService: {
    listAllTasks: vi.fn(),
    getAdminDetail: vi.fn(),
    reassignTask: vi.fn(),
    cancelTask: vi.fn(),
    listAvailableRiders: vi.fn(),
    createTaskForOrder: vi.fn(),
  },
}));

vi.mock('../src/modules/dispatch/dispatch.service', () => ({
  DispatchService: class {
    listAllTasks = mockDispatchService.listAllTasks;
    getAdminDetail = mockDispatchService.getAdminDetail;
    reassignTask = mockDispatchService.reassignTask;
    cancelTask = mockDispatchService.cancelTask;
    listAvailableRiders = mockDispatchService.listAvailableRiders;
    createTaskForOrder = mockDispatchService.createTaskForOrder;
  },
}));

import { DispatchService } from '../src/modules/dispatch/dispatch.service';

describe('AdminDispatchController - 装配 + 路由（批次 4）', () => {
  let controller: AdminDispatchController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminDispatchController(new DispatchService() as never);
  });

  it('GET /tasks - list 调 listAllTasks 传 query + 返回 { success, data }', async () => {
    const mockData = { items: [], nextCursor: null, hasMore: false };
    mockDispatchService.listAllTasks.mockResolvedValue(mockData);

    const result = await controller.list({
      status: 'ASSIGNED',
      limit: 20,
    } as never);

    expect(mockDispatchService.listAllTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ASSIGNED', limit: 20 }),
    );
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /tasks/:id - detail 调 getAdminDetail', async () => {
    const mockData = { id: 't-1', status: 'ASSIGNED' };
    mockDispatchService.getAdminDetail.mockResolvedValue(mockData);

    const result = await controller.detail('t-1');

    expect(mockDispatchService.getAdminDetail).toHaveBeenCalledWith('t-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /tasks/:id/reassign - 把 req.user.sub 作 adminUserId 透传 service', async () => {
    const mockData = { id: 't-1', status: 'ASSIGNED', riderId: 'r-new' };
    mockDispatchService.reassignTask.mockResolvedValue(mockData);

    const result = await controller.reassign(
      't-1',
      { newRiderId: 'r-new', reason: 'off-duty' },
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } } as never,
    );

    expect(mockDispatchService.reassignTask).toHaveBeenCalledWith({
      taskId: 't-1',
      newRiderId: 'r-new',
      adminUserId: 'admin-1',
      reason: 'off-duty',
    });
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /tasks/:id/reassign - req.user 缺失 → E-AUTH-002（service 不调）', async () => {
    await expect(
      controller.reassign('t-1', { newRiderId: 'r-2' }, {} as never),
    ).rejects.toMatchObject({ response: { code: 'E-AUTH-002' } });
    expect(mockDispatchService.reassignTask).not.toHaveBeenCalled();
  });

  it('POST /tasks/:id/cancel - 把 req.user.sub 作 adminUserId 透传 service', async () => {
    const mockData = { id: 't-1', status: 'FAILED' };
    mockDispatchService.cancelTask.mockResolvedValue(mockData);

    const result = await controller.cancel(
      't-1',
      { reason: 'duplicate' },
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } } as never,
    );

    expect(mockDispatchService.cancelTask).toHaveBeenCalledWith({
      taskId: 't-1',
      adminUserId: 'admin-1',
      reason: 'duplicate',
    });
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /tasks/:id/cancel - req.user 缺失 → E-AUTH-002（service 不调）', async () => {
    await expect(
      controller.cancel('t-1', {}, {} as never),
    ).rejects.toMatchObject({ response: { code: 'E-AUTH-002' } });
    expect(mockDispatchService.cancelTask).not.toHaveBeenCalled();
  });

  it('GET /riders/available - 调 listAvailableRiders', async () => {
    const mockData = [
      { id: 'r-1', riderName: 'Rider A', isOnline: true, totalDeliveries: 120 },
    ];
    mockDispatchService.listAvailableRiders.mockResolvedValue(mockData);

    const result = await controller.availableRiders();

    expect(mockDispatchService.listAvailableRiders).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /orders/:orderId/recreate - 调 createTaskForOrder + getAdminDetail（返回 admin view）', async () => {
    mockDispatchService.createTaskForOrder.mockResolvedValue({ id: 't-new' });
    mockDispatchService.getAdminDetail.mockResolvedValue({
      id: 't-new',
      status: 'PENDING_ASSIGN',
    });

    const result = await controller.recreate('o-1');

    expect(mockDispatchService.createTaskForOrder).toHaveBeenCalledWith('o-1');
    expect(mockDispatchService.getAdminDetail).toHaveBeenCalledWith('t-new');
    expect(result).toEqual({
      success: true,
      data: { id: 't-new', status: 'PENDING_ASSIGN' },
    });
  });
});
