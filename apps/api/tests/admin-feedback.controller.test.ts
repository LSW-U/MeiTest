/**
 * AdminFeedbackController 单测（admin-web 优化方案 批次2 2026-08-29）
 *
 * 覆盖 controller 装配：
 *   - 路由前缀 /api/v1/admin/feedback（@Controller 装饰器）
 *   - GET / 列表 → 调 adminListFeedback，返回 { success, data }
 *   - GET /:id 详情 → 调 adminGetFeedback，返回 { success, data }
 *
 * service 层逻辑（含 E-FEEDBACK-002 抛错）由 e2e + service 集成覆盖，这里只测 controller 装配。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminFeedbackController } from '../src/modules/feedback/admin-feedback.controller';

const { mockFeedbackService } = vi.hoisted(() => ({
  mockFeedbackService: {
    adminListFeedback: vi.fn(),
    adminGetFeedback: vi.fn(),
  },
}));

vi.mock('../src/modules/feedback/feedback.service', () => ({
  FeedbackService: class {
    adminListFeedback = mockFeedbackService.adminListFeedback;
    adminGetFeedback = mockFeedbackService.adminGetFeedback;
  },
}));

import { FeedbackService } from '../src/modules/feedback/feedback.service';

describe('AdminFeedbackController - 2 端点装配（批次2）', () => {
  let controller: AdminFeedbackController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new AdminFeedbackController(new FeedbackService() as never);
  });

  it('GET / - list 调 adminListFeedback 并透传全部 query，返回 { success, data }', async () => {
    const mockData = {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasMore: false,
    };
    mockFeedbackService.adminListFeedback.mockResolvedValue(mockData);

    const result = await controller.list({
      category: 'bug',
      keyword: 'crash',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.000Z',
      page: 1,
      pageSize: 20,
    });

    expect(mockFeedbackService.adminListFeedback).toHaveBeenCalledWith({
      category: 'bug',
      keyword: 'crash',
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-08-31T23:59:59.000Z',
      page: 1,
      pageSize: 20,
    });
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET / - 缺省 query 也透传 undefined（service 自填默认）', async () => {
    const mockData = { items: [], page: 1, pageSize: 20, total: 0, hasMore: false };
    mockFeedbackService.adminListFeedback.mockResolvedValue(mockData);

    const result = await controller.list({});

    expect(mockFeedbackService.adminListFeedback).toHaveBeenCalledWith({
      category: undefined,
      keyword: undefined,
      startDate: undefined,
      endDate: undefined,
      page: undefined,
      pageSize: undefined,
    });
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /:id - detail 调 adminGetFeedback(id)，返回 { success, data }', async () => {
    const mockData = {
      id: 'fb-1',
      userId: 'u-1',
      category: 'bug',
      content: 'something broke',
      contact: 'telegram:@x',
      images: [],
      createdAt: '2026-08-29T00:00:00.000Z',
      submitter: null,
    };
    mockFeedbackService.adminGetFeedback.mockResolvedValue(mockData);

    const result = await controller.detail('fb-1');

    expect(mockFeedbackService.adminGetFeedback).toHaveBeenCalledWith('fb-1');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /:id - service 抛 NotFoundException(E-FEEDBACK-002) 直接冒泡（controller 不吞）', async () => {
    const err = new Error('Feedback not found');
    mockFeedbackService.adminGetFeedback.mockRejectedValue(err);

    await expect(controller.detail('missing')).rejects.toThrow('Feedback not found');
  });
});
