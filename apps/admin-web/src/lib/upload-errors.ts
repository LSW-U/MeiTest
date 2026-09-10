/**
 * 上传错误分类 + 自动重试 + E-UPLOAD 本地化（upload 模块批B · 改动4，2026-09-10）
 *
 * admin-web 等价层（任务书 U1：MeiMart 仓内 admin 等价一份，不消费 MeiMart1.0
 * 的 upload-core——cookie 鉴权链路不同，但语义逐条对齐）：
 *   - 分类：network（fetch throw / HTTP 5xx）可重试；business（HTTP 4xx 校验失败）不重试
 *   - 自动重试 2 次、指数退避 1s → 2s（对齐 upload-core retry.ts）
 *   - 本地化：ApiError.code 命中 errors bundle（t(`errors.${code}`)），未命中兜底原始 message
 *
 * 进度（对齐 upload-core upload-state.ts 阶段拟真）：fetch 无上传字节流，
 * 发起前 0 → 响应头到达 60 → 解析完成 100；配合不确定态 spinner 展示阶段而非字节。
 */
import { ApiError } from '@/lib/api';

/** 上传错误类别（语义对齐 upload-core UploadErrorKind） */
export type UploadErrorKind = 'network' | 'business';

/** 结构化上传错误：类别（重试判定）+ 后端错误码（本地化） */
export class AdminUploadError extends Error {
  readonly kind: UploadErrorKind;
  readonly code?: string;
  readonly status?: number;

  constructor(
    kind: UploadErrorKind,
    message: string,
    options?: { code?: string; status?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'AdminUploadError';
    this.kind = kind;
    if (options?.code !== undefined) this.code = options.code;
    if (options?.status !== undefined) this.status = options.status;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** HTTP 5xx / 网络层错误 → network（可重试）；4xx → business（不重试，直接提示） */
export function isRetryableKind(kind: UploadErrorKind): boolean {
  return kind === 'network';
}

/** 任意抛出值 → AdminUploadError（ApiError 按 status 分类，未知 Error 按网络类防御） */
export function toUploadError(err: unknown): AdminUploadError {
  if (err instanceof AdminUploadError) return err;
  if (err instanceof ApiError) {
    // 4xx（含 E-AUTH-001 401 跳转）一律 business；5xx network
    return new AdminUploadError(err.status >= 500 ? 'network' : 'business', err.message, {
      code: err.code,
      status: err.status,
      cause: err,
    });
  }
  return new AdminUploadError('network', err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}

/** 上传内联进度阶段（对齐 upload-core 阶段拟真：0 → 60 → 100） */
export type UploadPhase = 'idle' | 'uploading' | 'done' | 'error';

/** 阶段 → 百分比（uploading 中段拟真 60，UI 配合 spinner 表达「进行中」） */
export function phaseToProgress(phase: UploadPhase): number {
  if (phase === 'done') return 100;
  if (phase === 'uploading') return 60;
  return 0;
}

/** 重试参数（对齐 upload-core RetryOptions 默认值） */
export interface UploadRetryOptions {
  /** 自动重试次数上限（默认 2，0 = 关闭） */
  retries?: number;
  /** 首次退避毫秒数（默认 1000，后续 ×2：1s → 2s） */
  baseDelayMs?: number;
  /** 测试注入：替换 sleep（单测免真实等待） */
  sleepFn?: (ms: number) => Promise<void>;
  /** 阶段回调：每轮尝试发出时推 'uploading'（重试轮 UI 保持进度态） */
  onPhase?: (phase: UploadPhase) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 带自动重试 + 阶段回调的上传执行器。
 *
 * @param attempt 执行一次上传的 thunk（每轮重新调用）
 * @returns 成功时返回 thunk 结果；失败抛 AdminUploadError（业务类首次抛出；网络类耗尽后抛最后一轮错误）
 */
export async function runUploadWithRetry<T>(
  attempt: () => Promise<T>,
  opts: UploadRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const wait = opts.sleepFn ?? sleep;

  let lastError: AdminUploadError | undefined;
  for (let round = 0; round <= retries; round++) {
    if (round > 0) await wait(baseDelayMs * Math.pow(2, round - 1));
    opts.onPhase?.('uploading');
    try {
      return await attempt();
    } catch (err) {
      const uploadErr = toUploadError(err);
      lastError = uploadErr;
      if (!isRetryableKind(uploadErr.kind)) throw uploadErr;
      // 网络类：继续下一轮（耗尽后循环结束抛出）
    }
  }
  throw lastError ?? new AdminUploadError('network', 'Upload failed after retries');
}

/**
 * E-UPLOAD 错误码 → 本地化文案。
 *
 * code 命中 errors namespace（shared-locales errors.json，next-intl 同 bundle 树）时
 * 用 `t('errors.' + code)`；未命中（裸中文无码错误 / 网络类无码）兜底原始 message。
 * has() 先探测再取值，避免 next-intl 运行时 MISSING_MESSAGE 噪声。
 */
export function localizeUploadError(
  err: AdminUploadError,
  t: (key: string) => string,
  has: (key: string) => boolean,
): string {
  if (err.code && has(`errors.${err.code}`)) return t(`errors.${err.code}`);
  return err.message || 'Upload failed';
}
