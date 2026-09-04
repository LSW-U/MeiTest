/**
 * AdminHotSearchController 单测（批次2 P3-2 2026-08-29）
 *
 * 覆盖 AdminHotSearchController 6 端点的 controller 装配层：
 *   GET    /                       list —— ZSET 真实热度 top N（lang/limit query）
 *   GET    /terms                  listTerms —— 种子词列表（P3-3：query 走 zod 枚举校验）
 *   GET    /zero-result            zeroResult —— 零结果词聚合
 *   POST   /terms                  createTerm —— 新增种子词
 *   PATCH  /terms/:id              updateTerm —— 编辑种子词
 *   DELETE /terms/:id              deleteTerm —— 删除种子词
 *
 * service 层逻辑由 search.service.test.ts 覆盖，这里只测 controller 装配：
 *   - 调用 service 时参数透传正确
 *   - response 一律 { success: true, data }
 *
 * P3-3 相关：listTerms 改用 AdminListTermsQuery zod schema（lang/type 走枚举校验），
 *   controller 单测 mock 不经 ZodValidationPipe，故补 query 直测：非法 type/lang
 *   经 ZodValidationPipe 应抛 BadRequest（见 describe('AdminListTermsQuery zod 校验')）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminHotSearchController } from '../src/modules/search/search.controller';
import { ZodValidationPipe } from '../src/shared/pipes/zod-validation.pipe';
import { AdminListTermsQuery } from '../src/modules/search/search.controller';

const { mockSearchService } = vi.hoisted(() => ({
  mockSearchService: {
    adminListHot: vi.fn(),
    listTerms: vi.fn(),
    listZeroResult: vi.fn(),
    createTerm: vi.fn(),
    updateTerm: vi.fn(),
    deleteTerm: vi.fn(),
  },
}));

vi.mock('../src/modules/search/search.service', () => ({
  SearchService: class {
    adminListHot = mockSearchService.adminListHot;
    listTerms = mockSearchService.listTerms;
    listZeroResult = mockSearchService.listZeroResult;
    createTerm = mockSearchService.createTerm;
    updateTerm = mockSearchService.updateTerm;
    deleteTerm = mockSearchService.deleteTerm;
  },
}));

import { SearchService } from '../src/modules/search/search.service';

describe('AdminHotSearchController - 6 端点装配（批次2 P3-2）', () => {
  let controller: AdminHotSearchController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new AdminHotSearchController(new SearchService() as never);
  });

  it('GET / - list 调用 adminListHot(lang, limit) 并返回 { success, data }', async () => {
    const mockData = [{ word: 'milk', lang: 'en', searchCount: 100 }];
    mockSearchService.adminListHot.mockResolvedValue(mockData);

    const result = await controller.list('en', '50');

    expect(mockSearchService.adminListHot).toHaveBeenCalledWith('en', 50);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET / - limit 默认 50，clamp 上限到 200（NaN/0 fallback 50）', async () => {
    mockSearchService.adminListHot.mockResolvedValue([]);

    await controller.list(undefined, undefined);
    expect(mockSearchService.adminListHot).toHaveBeenCalledWith(undefined, 50);

    await controller.list(undefined, '999');
    expect(mockSearchService.adminListHot).toHaveBeenLastCalledWith(undefined, 200);

    // '0' / 非数字走 NaN-fallback → 50（`|| 50` 兜底，与 client hot 端点一致的既有行为）
    await controller.list(undefined, '0');
    expect(mockSearchService.adminListHot).toHaveBeenLastCalledWith(undefined, 50);

    await controller.list(undefined, 'abc');
    expect(mockSearchService.adminListHot).toHaveBeenLastCalledWith(undefined, 50);
  });

  it('GET /terms - listTerms 透传 query.lang / query.type（P3-3 zod 校验后）', async () => {
    const mockData = [{ id: 't-1', word: 'apple', lang: 'en', type: 'PINNED' }];
    mockSearchService.listTerms.mockResolvedValue(mockData);

    const result = await controller.listTerms({ lang: 'zh', type: 'PINNED' });

    expect(mockSearchService.listTerms).toHaveBeenCalledWith('zh', 'PINNED');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /terms - 空 query 透传 undefined/undefined', async () => {
    mockSearchService.listTerms.mockResolvedValue([]);

    await controller.listTerms({});

    expect(mockSearchService.listTerms).toHaveBeenCalledWith(undefined, undefined);
  });

  it('GET /zero-result - zeroResult 透传 lang', async () => {
    const mockData = [{ word: 'rareresult', lang: 'en', count: 5 }];
    mockSearchService.listZeroResult.mockResolvedValue(mockData);

    const result = await controller.zeroResult('en');

    expect(mockSearchService.listZeroResult).toHaveBeenCalledWith('en');
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /terms - createTerm 透传 body', async () => {
    const body = { word: 'milk', lang: 'en', type: 'PINNED' as const };
    const mockData = { id: 't-1', ...body, sortOrder: 0, status: 'ACTIVE' };
    mockSearchService.createTerm.mockResolvedValue(mockData);

    const result = await controller.createTerm(body);

    expect(mockSearchService.createTerm).toHaveBeenCalledWith(body);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('PATCH /terms/:id - updateTerm 透传 id + body', async () => {
    const body = { type: 'BLOCKED' as const };
    const mockData = { id: 't-1', word: 'badword', lang: 'en', type: 'BLOCKED' };
    mockSearchService.updateTerm.mockResolvedValue(mockData);

    const result = await controller.updateTerm('t-1', body);

    expect(mockSearchService.updateTerm).toHaveBeenCalledWith('t-1', body);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('DELETE /terms/:id - deleteTerm 透传 id，返回 { success, data: { id } }', async () => {
    mockSearchService.deleteTerm.mockResolvedValue(undefined);

    const result = await controller.deleteTerm('t-1');

    expect(mockSearchService.deleteTerm).toHaveBeenCalledWith('t-1');
    expect(result).toEqual({ success: true, data: { id: 't-1' } });
  });

  it('所有 response 都是 { success: true, data }', async () => {
    mockSearchService.adminListHot.mockResolvedValue([]);
    mockSearchService.listTerms.mockResolvedValue([]);
    mockSearchService.listZeroResult.mockResolvedValue([]);
    mockSearchService.createTerm.mockResolvedValue({});
    mockSearchService.updateTerm.mockResolvedValue({});
    mockSearchService.deleteTerm.mockResolvedValue(undefined);

    const results = await Promise.all([
      controller.list(undefined, undefined),
      controller.listTerms({}),
      controller.zeroResult(undefined),
      controller.createTerm({ word: 'x', lang: 'en', type: 'PINNED' }),
      controller.updateTerm('t-1', { type: 'BLOCKED' }),
      controller.deleteTerm('t-1'),
    ]);

    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r).toHaveProperty('data');
    }
  });
});

/**
 * P3-3：AdminListTermsQuery zod 枚举校验直测
 *
 * controller 单测 mock 不经 ZodValidationPipe（见 [[meimart-controller-zod-test-blindspot]]），
 * 直接用 pipe + schema 等价覆盖：非法 type/lang 应抛 BadRequest（E-COMMON-001）。
 */
describe('AdminListTermsQuery zod 校验（P3-3 契约层）', () => {
  const pipe = new ZodValidationPipe(AdminListTermsQuery);

  it('合法 lang + type -> 通过', () => {
    expect(pipe.transform({ lang: 'zh', type: 'PINNED' }, {} as never)).toEqual({
      lang: 'zh',
      type: 'PINNED',
    });
  });

  it('空对象 -> 通过（lang/type 都可选）', () => {
    expect(pipe.transform({}, {} as never)).toEqual({});
  });

  it('非法 type -> 抛 BadRequest（不再默默透传 as 断言）', () => {
    expect(() => pipe.transform({ type: 'EVIL' }, {} as never)).toThrow(BadRequestException);
  });

  it('非法 lang -> 抛 BadRequest', () => {
    expect(() => pipe.transform({ lang: 'fr' }, {} as never)).toThrow(BadRequestException);
  });
});
