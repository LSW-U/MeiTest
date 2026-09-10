import { describe, it, expect } from 'vitest';
import {
  validateScoreWeights,
  stringifyScoreWeights,
  parseScoreWeightsOrNull,
  SCORE_WEIGHTS_PRESET_DEFAULT,
  SCORE_WEIGHTS_PRESET_DISTANCE_FIRST,
  SCORE_WEIGHTS_SUM_TOLERANCE,
  type DispatchScoreWeights,
} from '../src/dispatch-weights';

describe('dispatch-weights（批C C1 表单校验，对齐后端 zod refine 和=1）', () => {
  describe('validateScoreWeights', () => {
    it('和=1 合法（默认预设 0.5/0.3/0.2）', () => {
      const r = validateScoreWeights({ rating: 0.5, distance: 0.3, inTransit: 0.2 });
      expect(r.valid).toBe(true);
      expect(r.reason).toBeNull();
      expect(r.sum).toBe(1);
    });

    it('和=1 合法（距离优先预设 0.2/0.6/0.2）', () => {
      const r = validateScoreWeights({ rating: 0.2, distance: 0.6, inTransit: 0.2 });
      expect(r.valid).toBe(true);
      expect(r.sum).toBe(1);
    });

    it('和≠1 被拒（0.5/0.3/0.3 = 1.1），sum 返回展示值', () => {
      const r = validateScoreWeights({ rating: 0.5, distance: 0.3, inTransit: 0.3 });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('sum');
      expect(r.sum).toBe(1.1);
    });

    it('和≠1 被拒（0.5/0.3/0.1 = 0.9）', () => {
      const r = validateScoreWeights({ rating: 0.5, distance: 0.3, inTransit: 0.1 });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('sum');
      expect(r.sum).toBe(0.9);
    });

    it('浮点和 0.9999999999999998 在容差内视为合法（对齐后端 1e-9 容差）', () => {
      const w: DispatchScoreWeights = { rating: 0.5, distance: 0.2, inTransit: 0.3 };
      // 构造浮点误差组合：0.1+0.2+0.7
      const r = validateScoreWeights({ rating: 0.1, distance: 0.2, inTransit: 0.7 });
      expect(r.valid).toBe(true);
      expect(Math.abs(r.sum! - 1)).toBeLessThan(SCORE_WEIGHTS_SUM_TOLERANCE || 1e-6);
      void w;
    });

    it('单字段越界（rating=1.5）→ reason=rating', () => {
      const r = validateScoreWeights({ rating: 1.5, distance: 0.3, inTransit: 0.2 });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('rating');
    });

    it('负数越界（distance=-0.1）→ reason=distance', () => {
      const r = validateScoreWeights({ rating: 0.5, distance: -0.1, inTransit: 0.6 });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('distance');
    });

    it('多项越界 → reason=range', () => {
      const r = validateScoreWeights({ rating: 2, distance: -1, inTransit: 0 });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('range');
    });

    it('NaN 非有限数按越界处理', () => {
      const r = validateScoreWeights({ rating: NaN, distance: 0.5, inTransit: 0.5 });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('rating');
    });

    it('边界值 0 合法（0/0.5/0.5）', () => {
      const r = validateScoreWeights({ rating: 0, distance: 0.5, inTransit: 0.5 });
      expect(r.valid).toBe(true);
    });
  });

  describe('stringifyScoreWeights / parseScoreWeightsOrNull', () => {
    it('序列化为 SystemConfig JSON 值（三键，后端 parseScoreWeights 可消费）', () => {
      expect(stringifyScoreWeights({ rating: 0.5, distance: 0.3, inTransit: 0.2 })).toBe(
        '{"rating":0.5,"distance":0.3,"inTransit":0.2}',
      );
    });

    it('round-trip：stringify → parse 还原', () => {
      const w = { rating: 0.2, distance: 0.6, inTransit: 0.2 };
      expect(parseScoreWeightsOrNull(stringifyScoreWeights(w))).toEqual(w);
    });

    it('解析后端 seed 值', () => {
      expect(parseScoreWeightsOrNull('{"rating":0.5,"distance":0.3,"inTransit":0.2}')).toEqual({
        rating: 0.5,
        distance: 0.3,
        inTransit: 0.2,
      });
    });

    it('字段可读但和≠1 的存量非法值 → null（回显回退默认预设，对齐后端回退语义，P3-3）', () => {
      // 后端 parseScoreWeights 对此值回退代码常量 0.5/0.3/0.2 参与排序，
      // 前端回显必须同样回退（返回 null），不能展示后端不生效的 0.8/0.1/0.05。
      // 注：不能用 0.8/0.1/0.1 当反例——其浮点和恰为 1，是合法三元组
      expect(parseScoreWeightsOrNull('{"rating":0.8,"distance":0.1,"inTransit":0.05}')).toBeNull();
    });

    it('字段越界但 JSON 合法 → null', () => {
      expect(parseScoreWeightsOrNull('{"rating":1.5,"distance":0.3,"inTransit":0.2}')).toBeNull();
    });

    it('非法 JSON → null', () => {
      expect(parseScoreWeightsOrNull('not-json')).toBeNull();
    });

    it('缺字段 → null', () => {
      expect(parseScoreWeightsOrNull('{"rating":0.5}')).toBeNull();
    });

    it('空串/null/undefined → null（回退展示）', () => {
      expect(parseScoreWeightsOrNull('')).toBeNull();
      expect(parseScoreWeightsOrNull(null)).toBeNull();
      expect(parseScoreWeightsOrNull(undefined)).toBeNull();
    });
  });

  describe('预设', () => {
    it('默认预设 = 后端代码常量 0.5/0.3/0.2 且通过校验', () => {
      expect(SCORE_WEIGHTS_PRESET_DEFAULT).toEqual({ rating: 0.5, distance: 0.3, inTransit: 0.2 });
      expect(validateScoreWeights(SCORE_WEIGHTS_PRESET_DEFAULT).valid).toBe(true);
    });

    it('距离优先预设 0.2/0.6/0.2 且通过校验', () => {
      expect(SCORE_WEIGHTS_PRESET_DISTANCE_FIRST).toEqual({
        rating: 0.2,
        distance: 0.6,
        inTransit: 0.2,
      });
      expect(validateScoreWeights(SCORE_WEIGHTS_PRESET_DISTANCE_FIRST).valid).toBe(true);
    });
  });
});
