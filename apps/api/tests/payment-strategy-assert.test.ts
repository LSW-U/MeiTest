/**
 * P1-8 启动断言单测（后端配置门禁修复 批1，方案v2 D1）
 *
 * 覆盖（任务书-批1 单测三例）：
 *   a) PAYMENT_STRATEGY=real + 存在 isMock=true 策略（现状 6 个 mock）→ throw，不静默走 mock
 *   b) 未声明 PAYMENT_STRATEGY（undefined / 空串 / 纯空白）→ 不 throw，维持现状 mock 短路
 *   c) 声明列表命中非 mock 方法（COD,BANK_TRANSFER）→ 不 throw
 *   附加：未知 method → throw；mock 清单来自 listMockPaymentStrategies()（报错信息含 6 个 mock method）
 */
import { describe, it, expect } from 'vitest';
import {
  assertPaymentStrategyConsistent,
  listMockPaymentStrategies,
} from '../src/infrastructure/payment/payment.factory';

describe('assertPaymentStrategyConsistent（P1-8）', () => {
  it('a) PAYMENT_STRATEGY=real 且存在 isMock=true 策略 → throw（不静默走 mock）', () => {
    // 现状基线：6 个 mock 策略（wechat/paypal/stripe/wechat-global/alipay-cn/local-psp）
    const mockMethods = listMockPaymentStrategies().map((s) => s.method);
    expect(mockMethods.length).toBe(6);

    expect(() => assertPaymentStrategyConsistent('real')).toThrow(
      /PAYMENT_STRATEGY=real requires real strategies/,
    );
    // 报错清单直接取 listMockPaymentStrategies()：6 个 mock method 全部出现在错误信息中
    try {
      assertPaymentStrategyConsistent('real');
      expect.unreachable('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      for (const m of mockMethods) expect(msg).toContain(m);
    }
  });

  it('b) 未声明（undefined / 空串 / 空白）→ 不 throw，维持现状', () => {
    expect(() => assertPaymentStrategyConsistent(undefined)).not.toThrow();
    expect(() => assertPaymentStrategyConsistent('')).not.toThrow();
    expect(() => assertPaymentStrategyConsistent('   ')).not.toThrow();
  });

  it('c) 声明列表命中非 mock 方法（COD,BANK_TRANSFER）→ 不 throw', () => {
    expect(() => assertPaymentStrategyConsistent('COD,BANK_TRANSFER')).not.toThrow();
    expect(() => assertPaymentStrategyConsistent('cod')).not.toThrow(); // 大小写不敏感
  });

  it('附加：列表命中 isMock=true 方法（如 WECHAT）→ throw', () => {
    expect(() => assertPaymentStrategyConsistent('WECHAT')).toThrow(/still mock/);
    expect(() => assertPaymentStrategyConsistent('COD,WECHAT')).toThrow(/still mock/);
  });

  it('附加：未知 method → throw（fail-fast，含合法值清单）', () => {
    expect(() => assertPaymentStrategyConsistent('FOO')).toThrow(
      /declared unknown payment method: FOO/,
    );
  });
});
