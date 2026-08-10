/**
 * SettlementController 单测（总审查报告 P2-2a，2026-08-10）
 *
 * 补 controller 层 e2e（v1 漏审，批次 1.1 零 controller 测试覆盖）：
 *   - list / detail / confirm / run 装配（调 service + 返回 { success, data }）
 *   - confirm 把 req.user.sub 作 actorId 透传给 settle.confirm
 *
 * service 层逻辑由 settlement.service.test 覆盖，这里只测 controller 装配
 *
 * mock：SettlementService class（方法 = mock fn），参考 admin-user.controller.test.ts 模式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettlementController } from '../src/modules/settle/settlement.controller';

const { mockSettleService } = vi.hoisted(() => ({
  mockSettleService: {
    list: vi.fn(),
    detail: vi.fn(),
    confirm: vi.fn(),
    runSettlement: vi.fn(),
  },
}));

vi.mock('../src/modules/settle/settlement.service', () => ({
  SettlementService: class {
    list = mockSettleService.list;
    detail = mockSettleService.detail;
    confirm = mockSettleService.confirm;
    runSettlement = mockSettleService.runSettlement;
  },
}));

import { SettlementService } from '../src/modules/settle/settlement.service';

describe('SettlementController - 4 端点装配（总审查报告 P2-2a）', () => {
  let controller: SettlementController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SettlementController(new SettlementService() as never);
  });

  it('GET / - list 调 settle.list 传 query + 返回 { success, data }', async () => {
    const mockData = { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
    mockSettleService.list.mockResolvedValue(mockData);

    const result = await controller.list({ page: 1, pageSize: 20 } as never);

    expect(mockSettleService.list).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /:id - detail 调 settle.detail', async () => {
    const mockData = { id: 's-1', status: 'PENDING', totalAmount: 5800 };
    mockSettleService.detail.mockResolvedValue(mockData);

    const result = await controller.detail('s-1');

    expect(mockSettleService.detail).toHaveBeenCalledWith('s-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /:id/confirm - 把 req.user.sub 作 actorId 透传 settle.confirm（PENDING → CONFIRMED）', async () => {
    const mockData = { id: 's-1', status: 'CONFIRMED' };
    mockSettleService.confirm.mockResolvedValue(mockData);

    const result = await controller.confirm('s-1', {
      user: { sub: 'admin-1', role: 'SUPER_ADMIN' },
    } as never);

    expect(mockSettleService.confirm).toHaveBeenCalledWith('s-1', 'admin-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /run - 调 settle.runSettlement 传 body（手动触发，T+1 兜底）', async () => {
    const mockData = { created: 3 };
    mockSettleService.runSettlement.mockResolvedValue(mockData);

    const result = await controller.run({
      subjectType: 'SHOP',
      subjectId: 'shop-1',
      date: '2026-08-10',
    } as never);

    expect(mockSettleService.runSettlement).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: mockData });
  });
});
