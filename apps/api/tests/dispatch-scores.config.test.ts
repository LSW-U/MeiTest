/**
 * Dispatch Score Weights Config 单测（保证金批A A5，2026-09-10）
 *
 * 覆盖（任务书 A5 验收 ≥3 条）：
 *   - 缺省（null / 空串）→ 回退代码常量 DISPATCH_SCORE_WEIGHTS
 *   - 非法 JSON → 回退常量（不抛错）
 *   - 合法但和≠1 / 字段缺失 → schema safeParse 拒 → 回退常量
 *   - 合法 JSON → 原样解析（值透传，不落缓存副作用——纯函数）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/shared/db', () => ({ db: {} }));
vi.mock('../src/shared/cache', () => ({ redis: {} }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  parseScoreWeights,
  ScoreWeightsSchema,
} from '../src/modules/dispatch/dispatch-scores.config';
import { DISPATCH_SCORE_WEIGHTS } from '../src/modules/rider/deposit-eligibility.service';

describe('parseScoreWeights（A5 回退链）', () => {
  it('缺省（null / undefined / 空串）→ 回退代码常量', () => {
    expect(parseScoreWeights(null)).toEqual(DISPATCH_SCORE_WEIGHTS);
    expect(parseScoreWeights(undefined)).toEqual(DISPATCH_SCORE_WEIGHTS);
    expect(parseScoreWeights('')).toEqual(DISPATCH_SCORE_WEIGHTS);
  });

  it('非法 JSON → 回退常量（不抛错）', () => {
    expect(parseScoreWeights('not-json{')).toEqual(DISPATCH_SCORE_WEIGHTS);
    expect(parseScoreWeights('[1,2,3]')).toEqual(DISPATCH_SCORE_WEIGHTS); // 非对象也拒
  });

  it('和≠1 / 字段缺失 / 越界 → schema 拒 → 回退常量', () => {
    // 和≠1
    expect(parseScoreWeights('{"rating":0.5,"distance":0.3,"inTransit":0.1}')).toEqual(
      DISPATCH_SCORE_WEIGHTS,
    );
    // 字段缺失
    expect(parseScoreWeights('{"rating":0.5,"distance":0.5}')).toEqual(DISPATCH_SCORE_WEIGHTS);
    // 越界（rating>1）
    expect(parseScoreWeights('{"rating":1.2,"distance":-0.2,"inTransit":0}')).toEqual(
      DISPATCH_SCORE_WEIGHTS,
    );
  });

  it('合法 JSON → 原样解析（值透传）', () => {
    const raw = '{"rating":0.6,"distance":0.1,"inTransit":0.3}';
    expect(parseScoreWeights(raw)).toEqual({ rating: 0.6, distance: 0.1, inTransit: 0.3 });
    // 和=1 边界等值（0.5/0.3/0.2）
    expect(parseScoreWeights('{"rating":0.5,"distance":0.3,"inTransit":0.2}')).toEqual({
      rating: 0.5,
      distance: 0.3,
      inTransit: 0.2,
    });
  });

  it('ScoreWeightsSchema：和=1 refine 直测（和=1 过 / 和≠1 拒）', () => {
    expect(ScoreWeightsSchema.safeParse({ rating: 0, distance: 0, inTransit: 1 }).success).toBe(
      true,
    );
    expect(ScoreWeightsSchema.safeParse({ rating: 0.4, distance: 0.3, inTransit: 0.2 }).success).toBe(
      false,
    );
  });
});
