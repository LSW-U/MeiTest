/**
 * AuditController 单测（总审查报告 P2-2c，2026-08-10）
 *
 * 补 controller 层 e2e（v1 漏审，批次 1.3 零 controller 测试覆盖）：
 *   - list（游标 query）/ export（res.setHeader + return csv）/ detail（UUID 校验 + audit.detail）
 *   - detail UUID 非法 → E-COMMON-001（m1 修复：严格 UUID v4 正则）
 *
 * service 层 CSV injection 防护由 audit.service.test 覆盖（P2-1，escape = + - @ 前缀）
 *
 * mock：AuditService class + Response.setHeader，参考 admin-user.controller.test.ts 模式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditController } from '../src/modules/platform/audit.controller';

const { mockAuditService } = vi.hoisted(() => ({
  mockAuditService: {
    list: vi.fn(),
    detail: vi.fn(),
    exportCsv: vi.fn(),
  },
}));

vi.mock('../src/modules/platform/audit.service', () => ({
  AuditService: class {
    list = mockAuditService.list;
    detail = mockAuditService.detail;
    exportCsv = mockAuditService.exportCsv;
  },
}));

import { AuditService } from '../src/modules/platform/audit.service';

describe('AuditController - 3 端点装配（总审查报告 P2-2c）', () => {
  let controller: AuditController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AuditController(new AuditService() as never);
  });

  it('GET / - list 调 audit.list 传 query（游标分页）', async () => {
    const mockData = { items: [], nextCursor: null, hasMore: false };
    mockAuditService.list.mockResolvedValue(mockData);

    const result = await controller.list({ limit: 50 } as never);

    expect(mockAuditService.list).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /export - 调 audit.exportCsv + res.setHeader(Content-Type/Disposition) + return csv', async () => {
    const mockCsv = 'id,userId\nlog-1,user-1';
    mockAuditService.exportCsv.mockResolvedValue(mockCsv);
    const res = { setHeader: vi.fn() } as never;

    const result = await controller.exportCsv({ limit: 100 } as never, res);

    expect(mockAuditService.exportCsv).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="audit-logs-'),
    );
    expect(result).toBe(mockCsv);
  });

  it('GET /:id - UUID 合法 调 audit.detail', async () => {
    const uuid = '12345678-1234-1234-1234-123456789012';
    const mockData = {
      id: uuid,
      action: 'LOGIN',
      beforeData: null,
      afterData: null,
    };
    mockAuditService.detail.mockResolvedValue(mockData);

    const result = await controller.detail(uuid);

    expect(mockAuditService.detail).toHaveBeenCalledWith(uuid);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /:id - UUID 非法 → E-COMMON-001（m1 修复：严格 UUID v4 正则，service 不调）', async () => {
    await expect(controller.detail('not-a-uuid')).rejects.toMatchObject({
      response: { code: 'E-COMMON-001' },
    });
    expect(mockAuditService.detail).not.toHaveBeenCalled();
  });
});
