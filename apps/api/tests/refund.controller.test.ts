/**
 * AdminRefundController 单测（P3-3 retriggerReturnTask，2026-08-11）
 *
 * 补 controller 层装配测试：retrigger 端点调 createTaskForReturn + 返 task + auth 校验。
 * createTaskForReturn 业务逻辑（refund 存在/RETURN_REFUND/已有 task 校验）由 dispatch.service.test 覆盖，
 * 这里只测 controller 装配（调 service + 返回 { success, data }）+ req.user 缺失抛 E-AUTH-002。
 *
 * mock：RefundService（retrigger 不调，空 mock）+ DispatchService（createTaskForReturn）
 * 参考 admin-settlement.controller.test.ts 模式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AdminRefundController } from '../src/modules/refund/refund.controller';

const { mockRefundService, mockDispatchService } = vi.hoisted(() => ({
  mockRefundService: {
    listAllRefunds: vi.fn(),
    getRefundDetail: vi.fn(),
    reviewRefund: vi.fn(),
  },
  mockDispatchService: {
    createTaskForReturn: vi.fn(),
  },
}));

vi.mock('../src/modules/refund/refund.service', () => ({
  RefundService: class {
    listAllRefunds = mockRefundService.listAllRefunds;
    getRefundDetail = mockRefundService.getRefundDetail;
    reviewRefund = mockRefundService.reviewRefund;
  },
}));

vi.mock('../src/modules/dispatch/dispatch.service', () => ({
  DispatchService: class {
    createTaskForReturn = mockDispatchService.createTaskForReturn;
  },
}));

import { RefundService } from '../src/modules/refund/refund.service';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';

describe('AdminRefundController - P3-3 retriggerReturnTask', () => {
  let controller: AdminRefundController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminRefundController(
      new RefundService() as never,
      new DispatchService() as never,
    );
  });

  it('调 dispatchService.createTaskForReturn(id) + 返 { success: true, data: task }', async () => {
    const mockTask = {
      id: 'task-1',
      orderId: 'order-1',
      taskType: 'return',
      refundId: 'r1',
      status: 'PENDING_ASSIGN',
    };
    mockDispatchService.createTaskForReturn.mockResolvedValue(mockTask);

    const result = await controller.retriggerReturnTask('r1', {
      user: { sub: 'admin-1' },
    } as never);

    expect(mockDispatchService.createTaskForReturn).toHaveBeenCalledWith('r1');
    expect(result).toEqual({ success: true, data: mockTask });
  });

  it('无 req.user → 抛 HttpException E-AUTH-002 + 不调 createTaskForReturn', async () => {
    await expect(
      controller.retriggerReturnTask('r1', { user: undefined } as never),
    ).rejects.toThrow(HttpException);
    expect(mockDispatchService.createTaskForReturn).not.toHaveBeenCalled();
  });
});
