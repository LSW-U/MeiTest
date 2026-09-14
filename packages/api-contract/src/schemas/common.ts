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

/** 金额（整数分，USD cents，上限 9999.99 USD 防 overflow） */
export const Money = z.number().int().nonnegative().max(99_99_99);

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

/** 列表 + offset 分页响应（page/pageSize/total；与 PaginatedResponse 的 cursor 风格并列）
 *  settlement/withdrawal 等后台 offset 分页模块用 */
export function OffsetPaginatedResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(item),
      total: z.number().int(),
      page: z.number().int(),
      pageSize: z.number().int(),
    }),
  });
}

/** 错误响应：{ success: false, error: { code, message, details? } } */
export const ErrorResponse = z.object({
  success: z.literal(false),
  error: z.object({
    /** 错误码格式 E-MODULE-NNN（如 E-AUTH-001）或 E-HTTP-NNN 兜底 */
    code: z
      .string()
      .regex(
        /^E-[A-Z]+-\d{3}$|^E-HTTP-\d{3}$/,
        'INVALID_ERROR_CODE_FORMAT',
      ),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

// ===== 手机号归一化（批A R9，2026-09-15）=====

/**
 * 手机号归一化：去空格/横线/括号、`00` 国际前缀 → `+`，输出 E.164 标准形态
 *
 * 批A R9（真实 SMS）：存储与限流键统一归一化形态，防「同号异形绕过限流」。
 * 与 apps/api 共用实现：
 *   - guard（RateLimitGuard.resolveKey）在 ZodValidationPipe 之前跑，读 raw body，
 *     直接 import 本函数（api 经 @meimart/api-contract workspace 依赖可达）
 *   - schema 侧用 {@link PhoneE164}（z.preprocess 包本函数，POC 已验证
 *     zod-to-openapi 7.3.4 只渲染内层 string+pattern，preprocess 本体不进 OpenAPI）
 *
 * 规则（先清洗再校验，不硬编码 +670，通用 E.164）：
 *   1. trim + 去掉所有空格/横线/括号（+670 7xx xxxx / +670-7xx-xxxx / (01) 2345 ）
 *   2. `00` 国际前缀 → `+`（00670... → +670...）
 *   3. 结果必须 `^\+[1-9]\d{1,14}$`，否则返回 undefined（schema 层拒收）
 */
export function normalizePhoneE164(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  let v = input.trim().replace(/[\s\-().]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return /^\+[1-9]\d{1,14}$/.test(v) ? v : undefined;
}

/** E.164 手机号（先归一化再校验；非法格式在 preprocess 阶段拒收 → 400 E-COMMON-001） */
export const PhoneE164 = z.preprocess(
  normalizePhoneE164,
  z.string().regex(/^\+[1-9]\d{1,14}$/, 'PHONE_NOT_E164'),
);
