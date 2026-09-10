/**
 * 派单排序权重校验（保证金拦截链批C C1，2026-09-11）
 *
 * 方案：方案v2-保证金拦截链与可配化-20260910 §0 T2 + §3 批C C1
 *
 * 职责：admin-web 权重配置页的**纯校验/预设逻辑**（不触网络/DB），
 * 与后端 apps/api dispatch-scores.config.ts 的 ScoreWeightsSchema（zod refine
 * 和=1，容差 1e-9）语义对齐——前端先拦一道，后端 zod 仍是权威。
 *
 * 放 shared-utils 而非 admin-web 内联：admin-web 无单测环境（vitest 在
 * shared-utils），校验逻辑必须有单测（任务书 C1 验收线「表单校验单测」）。
 */

/** 权重 shape（对齐后端 ScoreWeights = {rating,distance,inTransit}，和=1） */
export interface DispatchScoreWeights {
  rating: number;
  distance: number;
  inTransit: number;
}

/** 后端 zod refine 同款容差：Math.abs(sum - 1) < 1e-9（dispatch-scores.config.ts:29） */
export const SCORE_WEIGHTS_SUM_TOLERANCE = 1e-9;

/** 权重校验结果 */
export interface ScoreWeightsValidation {
  valid: boolean;
  /** 和≠1 时的当前和（已四舍五入到 6 位，供 UI 展示）；字段越界时为 null */
  sum: number | null;
  /** 失败原因：'sum'（和≠1）或字段名（越界）或 'range'（多项越界）；合法时 null */
  reason: 'sum' | 'rating' | 'distance' | 'inTransit' | 'range' | null;
}

/**
 * 校验权重三元组：每项 ∈ [0,1] 且和=1（容差 1e-9，对齐后端 zod refine）。
 * 非有限数（NaN/Infinity）按越界处理。
 */
export function validateScoreWeights(w: DispatchScoreWeights): ScoreWeightsValidation {
  const fields: Array<keyof DispatchScoreWeights> = ['rating', 'distance', 'inTransit'];
  const outOfRange = fields.filter(
    (f) => !Number.isFinite(w[f]) || w[f] < 0 || w[f] > 1,
  );
  if (outOfRange.length === 1) {
    return { valid: false, sum: null, reason: outOfRange[0] };
  }
  if (outOfRange.length > 1) {
    return { valid: false, sum: null, reason: 'range' };
  }
  const sum = w.rating + w.distance + w.inTransit;
  if (Math.abs(sum - 1) >= SCORE_WEIGHTS_SUM_TOLERANCE) {
    return { valid: false, sum: round6(sum), reason: 'sum' };
  }
  return { valid: true, sum: round6(sum), reason: null };
}

/** 保留 6 位小数（浮点和展示用，如 0.9999999999999998 → 1） */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 序列化为 SystemConfig 存储值（JSON 字符串，后端 parseScoreWeights 消费） */
export function stringifyScoreWeights(w: DispatchScoreWeights): string {
  return JSON.stringify({ rating: w.rating, distance: w.distance, inTransit: w.inTransit });
}

/**
 * 从 SystemConfig 原始值解析；非法/缺省/和≠1 返回 null（由调用方回退默认预设展示）。
 *
 * 和=1 过滤对齐后端语义（审查报告批C P3-3）：后端 parseScoreWeights 对「可读但
 * 和≠1」的存量值回退代码常量参与排序，前端回显若不过滤会展示后端不生效的值——
 * 此处 parse 后先过 validateScoreWeights，valid=false 一律返回 null，与后端
 * 回退行为（0.5/0.3/0.2）保持一致。
 */
export function parseScoreWeightsOrNull(raw: string | null | undefined): DispatchScoreWeights | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const w: DispatchScoreWeights = {
      rating: typeof obj.rating === 'number' ? obj.rating : NaN,
      distance: typeof obj.distance === 'number' ? obj.distance : NaN,
      inTransit: typeof obj.inTransit === 'number' ? obj.inTransit : NaN,
    };
    // 字段可读 + 和=1（容差同后端）双过才放行；任一不过 → null（调用方回退默认预设）
    if (!validateScoreWeights(w).valid) return null;
    return w;
  } catch {
    return null;
  }
}

/** 预设：默认（=后端代码常量 DISPATCH_SCORE_WEIGHTS 0.5/0.3/0.2） */
export const SCORE_WEIGHTS_PRESET_DEFAULT: DispatchScoreWeights = {
  rating: 0.5,
  distance: 0.3,
  inTransit: 0.2,
};

/** 预设：距离优先（方案 v2 T2 0.2/0.6/0.2） */
export const SCORE_WEIGHTS_PRESET_DISTANCE_FIRST: DispatchScoreWeights = {
  rating: 0.2,
  distance: 0.6,
  inTransit: 0.2,
};
