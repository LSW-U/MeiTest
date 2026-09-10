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

/**
 * 选图后本地预校验（upload 模块批C · 批B P3-1 移交账，2026-09-10）
 *
 * admin 等价层此前只有错误分类/重试/本地化，无预校验（批B 审查 P3-1）——
 * 错比例图靠后端 400 往返报错，弱网下体验差一档。本函数补齐 admin 等价：
 * 规则逐条对齐 upload-core precheck.ts SCENE_RULES（客户端 App 同款语义），
 * 错误码与后端 E-UPLOAD 对齐（010 类型 / 002 过大 / 016 过小 / 020 非方图 /
 * 021 宽度或最大边越界 / 022 比例越界），命中即抛 PrecheckError。
 *
 * ⚠️ 预校验是体验优化不是安全边界——后端逐端点强校验仍是权威
 * （magic bytes 防伪造只有后端能做）；尺寸取自图片元数据可被构造，不作信任依据。
 *
 * admin 场景（对齐 upload-core SCENE_RULES）：
 *   - product-image：1:1 容差5% + 200–2000px + ≤5MB（主图/图片墙/分类图标）
 *   - banner-image：宽 600–2000 + 比例 1.5–3.0 + ≤5MB（宽度违规报 021）
 */

/** admin 预校验失败（code 与后端 E-UPLOAD 对齐，走 localizeUploadError 直接本地化） */
export class PrecheckError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PrecheckError';
    this.code = code;
  }
}

/** 全场景共用常量（与后端 upload.helpers.ts / upload-core UPLOAD_LIMITS 一致） */
export const UPLOAD_LIMITS = {
  /** 5MB（后端 MAX_FILE_SIZE 一致） */
  maxBytes: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
} as const;

/** 场景预校验规则（逐条对齐 upload-core SCENE_RULES，key 同名） */
export interface UploadSceneRule {
  minEdge?: number;
  minWidth?: number;
  minHeight?: number;
  maxEdge?: number;
  square?: boolean;
  squareTolerance?: number;
  ratioRange?: [number, number];
  /** minWidth 违规的错误码覆盖（默认 E-UPLOAD-016；banner 后端用 021 宽度越界） */
  minWidthCode?: string;
}

/** admin 两场景规则表（与 upload-core SCENE_RULES 对齐；client/rider 场景在 MeiMart1.0 侧消费） */
export const UPLOAD_SCENE_RULES: Record<string, UploadSceneRule> = {
  // admin 商品图（主图/图片墙/分类图标）：1:1 容差5% + 200–2000px
  'product-image': { minEdge: 200, maxEdge: 2000, square: true, squareTolerance: 0.05 },
  // admin banner：宽 600–2000 + 比例 1.5–3.0（宽度违规后端报 021）
  'banner-image': { minWidth: 600, maxEdge: 2000, ratioRange: [1.5, 3.0], minWidthCode: 'E-UPLOAD-021' },
};

/** 预校验输入（尺寸由调用方提供：web Image 解码 / 上传前 readImageDimensions） */
export interface PrecheckInput {
  mimeType?: string;
  /** 文件字节大小（File.size，null 跳过大小校验） */
  sizeBytes?: number | null;
  width: number;
  height: number;
}

/**
 * 按场景预校验（对齐 upload-core precheckImage；先抛码后抛尺寸类，规则顺序一致）。
 * @param scene UPLOAD_SCENE_RULES 的 key 或自定义 UploadSceneRule
 * @throws PrecheckError（code 与后端 E-UPLOAD 对齐）
 */
export function precheckUploadImage(
  scene: string | UploadSceneRule,
  input: PrecheckInput,
): void {
  const rule = typeof scene === 'string' ? UPLOAD_SCENE_RULES[scene] : scene;
  if (!rule) throw new PrecheckError('E-UPLOAD-010', `Unknown upload scene: ${String(scene)}`);

  if (input.mimeType && !UPLOAD_LIMITS.allowedMimeTypes.includes(input.mimeType)) {
    throw new PrecheckError('E-UPLOAD-010', `Unsupported image type: ${input.mimeType}`);
  }
  if (typeof input.sizeBytes === 'number' && input.sizeBytes > UPLOAD_LIMITS.maxBytes) {
    throw new PrecheckError('E-UPLOAD-002', `File too large: ${input.sizeBytes} bytes (max 5MB)`);
  }

  const { width, height } = input;
  if (width <= 0 || height <= 0) {
    throw new PrecheckError('E-UPLOAD-016', `Invalid image dimensions: ${width}x${height}`);
  }

  if (rule.square) {
    const tolerance = rule.squareTolerance ?? 0.05;
    if (Math.abs(width / height - 1) > tolerance) {
      throw new PrecheckError('E-UPLOAD-020', `Image must be 1:1 square (current ${width}x${height})`);
    }
  }
  if (rule.ratioRange) {
    const ratio = width / height;
    const [min, max] = rule.ratioRange;
    if (ratio < min || ratio > max) {
      throw new PrecheckError('E-UPLOAD-022', `Aspect ratio ${width}:${height} out of range ${min}:1 - ${max}:1`);
    }
  }
  if (rule.minEdge !== undefined && Math.min(width, height) < rule.minEdge) {
    throw new PrecheckError('E-UPLOAD-016', `Image too small (current ${width}x${height}, min ${rule.minEdge}px)`);
  }
  if (rule.minWidth !== undefined && width < rule.minWidth) {
    throw new PrecheckError(
      rule.minWidthCode ?? 'E-UPLOAD-016',
      `Image width too small (current ${width}, min ${rule.minWidth}px)`,
    );
  }
  if (rule.minHeight !== undefined && height < rule.minHeight) {
    throw new PrecheckError('E-UPLOAD-016', `Image height too small (current ${height}, min ${rule.minHeight}px)`);
  }
  if (rule.maxEdge !== undefined && Math.max(width, height) > rule.maxEdge) {
    throw new PrecheckError('E-UPLOAD-021', `Image too large (current ${Math.max(width, height)}, max ${rule.maxEdge}px)`);
  }
}

/**
 * admin 上传场景 → 预校验规则 key（upload-scenes.ts UPLOAD_SCENES 的场景名，
 * 此处反向映射避免 upload-scenes → upload-errors 循环依赖）。
 * product-image 端点的 4 个场景共用 product-image 规则；banner 走 banner-image。
 */
const SCENE_TO_PRECHECK_RULE: Record<string, string> = {
  'product-main-create': 'product-image',
  'product-main-edit': 'product-image',
  'product-image-wall': 'product-image',
  'category-icon': 'product-image',
  banner: 'banner-image',
};

/**
 * web 侧读取图片真实宽高（File 对象无 RN asset.width/height 元数据，需解码）。
 * createImageBitmap 优先（web 标准，返回位图自带宽高）；不可用或解码失败时
 * 兜底 Image + objectURL；再失败返回 null——调用方跳过尺寸预校验直传
 * （对齐 client-app「元数据取不到跳过、后端兜底」范式，预校验不是安全边界）。
 */
export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    } catch {
      // fallthrough 到 Image 兜底（部分浏览器对特定编码 createImageBitmap 会拒）
    }
  }
  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    try {
      return await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('image decode failed'));
        };
        img.src = url;
      });
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * admin 5 上传位统一预校验入口（批C · 批B P3-1 移交账，2026-09-10）。
 *
 * 顺序与 upload-core precheckImage 一致：mime（010）→ size（002）→ 解码尺寸 →
 * 场景尺寸规则（016/020/021/022）。mime/size 来自 File 元数据始终可校验；
 * 尺寸解码失败时跳过尺寸规则直接放行（后端逐端点强校验兜底，不阻断上传）。
 *
 * @param scene upload-scenes.ts UPLOAD_SCENES 的场景名；未注册场景直接放行
 *             （CSV 导入等非图片场景不预校验）
 * @throws PrecheckError（code 与后端 E-UPLOAD 对齐，调用方 t(`errors.${code}`) 本地化）
 */
export async function precheckUploadFile(scene: string, file: File): Promise<void> {
  const ruleKey = SCENE_TO_PRECHECK_RULE[scene];
  if (!ruleKey) return;
  if (file.type && !UPLOAD_LIMITS.allowedMimeTypes.includes(file.type)) {
    throw new PrecheckError('E-UPLOAD-010', `Unsupported image type: ${file.type}`);
  }
  if (file.size > UPLOAD_LIMITS.maxBytes) {
    throw new PrecheckError('E-UPLOAD-002', `File too large: ${file.size} bytes (max 5MB)`);
  }
  const dims = await readImageDimensions(file);
  if (!dims || dims.width <= 0 || dims.height <= 0) return;
  precheckUploadImage(ruleKey, { width: dims.width, height: dims.height });
}
