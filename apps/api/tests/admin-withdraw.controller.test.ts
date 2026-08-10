/**
 * WithdrawalController 单测（总审查报告 P2-2b，2026-08-10）
 *
 * 补 controller 层 e2e（v1 漏审，批次 1.2 零 controller 测试覆盖）：
 *   - create / list / detail / review / mark-paid 装配（调 service + 返回 { success, data }）
 *   - create/review/mark-paid 把 req.user.sub 作 actorId 透传给 service
 *
 * 权限：写操作（create/review/mark-paid）方法级 @Roles('SUPER_ADMIN')，读（list/detail）三角色
 * （审查报告批次 2 观察-1 已 verify withdraw 写收紧 SUPER_ADMIN，commit bea1af8）
 *
 * mock：WithdrawalService class（方法 = mock fn），参考 admin-user.controller.test.ts 模式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WithdrawalController } from '../src/modules/settle/withdraw.controller';

const { mockWithdrawService } = vi.hoisted(() => ({
  mockWithdrawService: {
    create: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    review: vi.fn(),
    markPaid: vi.fn(),
  },
}));

vi.mock('../src/modules/settle/withdraw.service', () => ({
  WithdrawalService: class {
    create = mockWithdrawService.create;
    list = mockWithdrawService.list;
    detail = mockWithdrawService.detail;
    review = mockWithdrawService.review;
    markPaid = mockWithdrawService.markPaid;
  },
}));

import { WithdrawalService } from '../src/modules/settle/withdraw.service';

describe('WithdrawalController - 5 端点装配（总审查报告 P2-2b）', () => {
  let controller: WithdrawalController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new WithdrawalController(new WithdrawalService() as never);
  });

  it('POST / - create 调 withdraw.create 传 body + req.user.sub（super_admin 代录）', async () => {
    const mockData = { id: 'w-1', status: 'PENDING', amount: 10000 };
    mockWithdrawService.create.mockResolvedValue(mockData);

    const result = await controller.create(
      {
        requesterType: 'SHOP',
        requesterId: 'shop-1',
        amount: 10000,
        payoutAccount: { channel: 'BANK', account: '123' },
      } as never,
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } },
    );

    expect(mockWithdrawService.create).toHaveBeenCalledWith(expect.anything(), 'admin-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET / - list 调 withdraw.list 传 query', async () => {
    const mockData = { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
    mockWithdrawService.list.mockResolvedValue(mockData);

    const result = await controller.list({ page: 1, pageSize: 20 } as never);

    expect(mockWithdrawService.list).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /:id - detail 调 withdraw.detail', async () => {
    const mockData = { id: 'w-1', status: 'PENDING', amount: 10000 };
    mockWithdrawService.detail.mockResolvedValue(mockData);

    const result = await controller.detail('w-1');

    expect(mockWithdrawService.detail).toHaveBeenCalledWith('w-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/review - 调 withdraw.review 传 id + body + req.user.sub（APPROVE/REJECT，super_admin only）', async () => {
    const mockData = { id: 'w-1', status: 'APPROVED' };
    mockWithdrawService.review.mockResolvedValue(mockData);

    const result = await controller.review(
      'w-1',
      { action: 'APPROVE' } as never,
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } },
    );

    expect(mockWithdrawService.review).toHaveBeenCalledWith(
      'w-1',
      expect.objectContaining({ action: 'APPROVE' }),
      'admin-1',
    );
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/mark-paid - 调 withdraw.markPaid 传 id + body + req.user.sub（super_admin only）', async () => {
    const mockData = { id: 'w-1', status: 'PAID' };
    mockWithdrawService.markPaid.mockResolvedValue(mockData);

    const result = await controller.markPaid(
      'w-1',
      { payoutReference: 'TXN-001' } as never,
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } },
    );

    expect(mockWithdrawService.markPaid).toHaveBeenCalledWith(
      'w-1',
      expect.objectContaining({ payoutReference: 'TXN-001' }),
      'admin-1',
    );
    expect(result).toEqual({ success: true, data: mockData });
  });
});
