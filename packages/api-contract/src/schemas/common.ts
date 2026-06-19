/**
 * 通用 schema：ID / 金额 / 时间 / 多语言 / 响应包装 / 分页 / 错误
 *
 * 决策依据：
 * - 金额单位：契约 v0.2 §1.3 — 整数（分），不用 float
 * - 多语言：契约 v0.3 决策 B — Record<string, string> JSON
 * - 时间：契约 v0.2 §1.3 — ISO 8601 UTC 字符串
 */
import { z } from 'zod';

/** UUID v4 */
export const Id = z.string().uuid();

/** 金额（整数分，USD cents） */
export const Money = z.number().int().nonnegative();

/** ISO 8601 UTC 时间字符串 */
export const IsoTimestamp = z.string().datetime();

/** 多语言文本，键为语言代码（en/id/zh/pt/tet） */
export const I18nText = z.record(z.string(), z.string());

/** 支持的语言代码 */
export const LanguageCode = z.enum(['en', 'id', 'zh', 'pt', 'tet']);

/** 成功响应包装：{ success: true, data, message? } */
export function ApiResponse<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    message: z.string().optional(),
  });
}

/** 列表 + 游标分页响应 */
export function PaginatedResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(item),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
      total: z.number().int().optional(),
    }),
  });
}

/** 错误响应：{ success: false, error: { code, message, details? } } */
export const ErrorResponse = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
