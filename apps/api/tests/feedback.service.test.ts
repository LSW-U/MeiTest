/**
 * Feedback Service 单测（P22 F1，2026-08-19）
 *
 * 覆盖 FeedbackService.createFeedback：
 *   - 正常提交（含 images + contact）-> 落库 + 视图字段齐 + ISO createdAt
 *   - contact 空串归一为 null（前端 contact 是 '' | string）
 *   - images 空数组 -> 直接落库（isOwnUrl 不炸）
 *   - ⭐ images URL 非本服务上传 -> 409 E-FEEDBACK-001（防 SSRF/追踪/钓鱼，同 Refund.photos 模式）
 *   - 混合 URL 只要一条非本服务 -> 整体拒
 *
 * controller zod 校验（category 枚举 / content 10-500 / contact ≤60 / images ≤9）
 * 由 ZodValidationPipe 前置拦，不在 service 单测覆盖（见 [[meimart-controller-zod-test-blindspot]]，
 * 走 e2e 或直接 safeParse contract schema）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';

const { mockDb, mockStorage } = vi.hoisted(() => ({
  mockDb: { feedback: { create: vi.fn() } },
  mockStorage: { isOwnUrl: vi.fn() },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FeedbackService } from '../src/modules/feedback/feedback.service';
import { CreateFeedbackRequest } from '@meimart/api-contract';

const OWN_URL = 'http://localhost:9000/meimart/feedbacks/image-1789xxx-abcd1234.jpg';

/**
 * controller zod 校验直测（controller 单测 mock 不经 ZodValidationPipe，见
 * [[meimart-controller-zod-test-blindspot]]：直接 safeParse contract schema 等价覆盖）
 */
describe('CreateFeedbackRequest zod 校验（P22 F1 契约层）', () => {
  const valid = {
    category: 'product',
    content: 'Some feedback text over 10 chars',
  };

  it('合法最小载荷 -> 通过（contact/images 可省，images default []）', () => {
    const r = CreateFeedbackRequest.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.images).toEqual([]);
      expect(r.data.contact).toBeUndefined();
    }
  });

  it('category 枚举外 -> 拒（前端必须 .split(\'.\').pop() 转尾段，整段 i18n key 拒）', () => {
    const r = CreateFeedbackRequest.safeParse({
      ...valid,
      category: 'service.feedback.types.product',
    });
    expect(r.success).toBe(false);
  });

  it('content < 10 字 -> 拒（与前端 schema min:10 对齐）', () => {
    const r = CreateFeedbackRequest.safeParse({ ...valid, content: 'short' });
    expect(r.success).toBe(false);
  });

  it('content > 500 字 -> 拒', () => {
    const r = CreateFeedbackRequest.safeParse({ ...valid, content: 'x'.repeat(501) });
    expect(r.success).toBe(false);
  });

  it('contact > 60 字 -> 拒（与前端 schema max:60 对齐）', () => {
    const r = CreateFeedbackRequest.safeParse({ ...valid, contact: 'c'.repeat(61) });
    expect(r.success).toBe(false);
  });

  it('images > 9 张 -> 拒（后端宽松同 review/refund，前端限 3）', () => {
    const r = CreateFeedbackRequest.safeParse({
      ...valid,
      images: Array.from({ length: 10 }, (_, i) => `https://localhost:9000/meimart/x-${i}.jpg`),
    });
    expect(r.success).toBe(false);
  });

  it('images 非 URL 字符串 -> 拒', () => {
    const r = CreateFeedbackRequest.safeParse({ ...valid, images: ['not-a-url'] });
    expect(r.success).toBe(false);
  });
});

describe('FeedbackService (P22 F1)', () => {
  let service: FeedbackService;

  beforeEach(() => {
    mockDb.feedback.create.mockReset();
    mockStorage.isOwnUrl.mockReset();
    service = new FeedbackService(mockStorage as never);
  });

  const dbRow = (over: Record<string, unknown> = {}) => ({
    id: 'fb-1',
    userId: 'user-1',
    category: 'product',
    content: 'App is great overall',
    contact: null,
    images: [] as string[],
    createdAt: new Date('2026-08-19T00:00:00Z'),
    ...over,
  });

  it('正常提交（含 images + contact）-> 落库 + 视图字段齐 + createdAt ISO', async () => {
    mockStorage.isOwnUrl.mockReturnValue(true);
    mockDb.feedback.create.mockResolvedValueOnce(dbRow({ images: [OWN_URL], contact: '+670123' }));

    const result = await service.createFeedback({
      userId: 'user-1',
      category: 'product',
      content: 'App is great overall',
      contact: '+670123',
      images: [OWN_URL],
    });

    expect(mockDb.feedback.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        category: 'product',
        content: 'App is great overall',
        contact: '+670123',
        images: [OWN_URL],
      },
    });
    expect(result).toEqual({
      id: 'fb-1',
      userId: 'user-1',
      category: 'product',
      content: 'App is great overall',
      contact: '+670123',
      images: [OWN_URL],
      createdAt: '2026-08-19T00:00:00.000Z',
    });
  });

  it('contact 空串 -> 归一为 null 落库（前端 schema contact 是 "" | string）', async () => {
    mockStorage.isOwnUrl.mockReturnValue(true);
    mockDb.feedback.create.mockResolvedValueOnce(dbRow());

    await service.createFeedback({
      userId: 'user-1',
      category: 'other',
      content: 'Some feedback text',
      contact: '',
      images: [],
    });

    expect(mockDb.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contact: null }) }),
    );
  });

  it('contact 不传（undefined）-> 同样归一为 null', async () => {
    mockStorage.isOwnUrl.mockReturnValue(true);
    mockDb.feedback.create.mockResolvedValueOnce(dbRow());

    await service.createFeedback({
      userId: 'user-1',
      category: 'feature',
      content: 'Some feedback text',
      images: [],
    });

    expect(mockDb.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contact: null }) }),
    );
  });

  it('images 空数组 -> 不调 isOwnUrl 直接落库', async () => {
    mockDb.feedback.create.mockResolvedValueOnce(dbRow());

    await service.createFeedback({
      userId: 'user-1',
      category: 'order',
      content: 'Some feedback text',
      images: [],
    });

    expect(mockStorage.isOwnUrl).not.toHaveBeenCalled();
    expect(mockDb.feedback.create).toHaveBeenCalled();
  });

  it('⭐ images URL 非本服务上传 -> 抛 Conflict E-FEEDBACK-001 且不落库（防 SSRF/外链）', async () => {
    mockStorage.isOwnUrl.mockReturnValueOnce(false);

    await expect(
      service.createFeedback({
        userId: 'user-1',
        category: 'payment',
        content: 'Some feedback text',
        images: ['https://evil.com/track.png'],
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockDb.feedback.create).not.toHaveBeenCalled();
  });

  it('混合 URL 只要一条非本服务 -> 整体拒（第一条过了第二条炸）', async () => {
    mockStorage.isOwnUrl.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await expect(
      service.createFeedback({
        userId: 'user-1',
        category: 'shipping',
        content: 'Some feedback text',
        images: [OWN_URL, 'https://evil.com/x.png'],
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockDb.feedback.create).not.toHaveBeenCalled();
  });
});
