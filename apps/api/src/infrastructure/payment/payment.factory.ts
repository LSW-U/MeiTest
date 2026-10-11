/**
 * 支付策略工厂（按 PaymentMethod 选 strategy）
 *
 * 用法：
 *   import { getPaymentStrategy } from '@/infrastructure/payment';
 *   const strategy = getPaymentStrategy('WECHAT');
 *   const intent = await strategy.createPayment({...});
 */
import type { PaymentMethodCode, PaymentStrategy } from './payment-strategy';
import { CodStrategy } from './cod.strategy';
import { BankTransferStrategy } from './bank-transfer.strategy';
import { WechatStrategy } from './wechat.strategy';
import { PaypalStrategy } from './paypal.strategy';
import { StripeStrategy } from './stripe.strategy';
import { WechatGlobalStrategy } from './wechat-global.strategy';
import { AlipayCnStrategy } from './alipay-cn.strategy';
import { LocalPspStrategy } from './local-psp.strategy';

// 批B 补位 3 渠道（WECHAT_GLOBAL/ALIPAY_CN/LOCAL_PSP）为 stub 占位，config available=false
// 挡住下单（R2）；注册在此保证 PaymentProvider 抽象完整（切真时加实现即可）
const STRATEGIES: Record<PaymentMethodCode, PaymentStrategy> = {
  COD: new CodStrategy(),
  BANK_TRANSFER: new BankTransferStrategy(),
  WECHAT: new WechatStrategy(),
  PAYPAL: new PaypalStrategy(),
  STRIPE: new StripeStrategy(),
  WECHAT_GLOBAL: new WechatGlobalStrategy(),
  ALIPAY_CN: new AlipayCnStrategy(),
  LOCAL_PSP: new LocalPspStrategy(),
};

export function getPaymentStrategy(method: PaymentMethodCode): PaymentStrategy {
  const strategy = STRATEGIES[method];
  if (!strategy) {
    throw new Error(`UNSUPPORTED_PAYMENT_METHOD: ${method}`);
  }
  return strategy;
}

export function getAllPaymentStrategies(): PaymentStrategy[] {
  return Object.values(STRATEGIES);
}

/** W7 上线前 checklist：检查是否还有 mock/stub 残留 */
export function listMockPaymentStrategies(): PaymentStrategy[] {
  return Object.values(STRATEGIES).filter((s) => s.isMock);
}

/**
 * P1-8 启动断言：PAYMENT_STRATEGY 声明与工厂实际策略 isMock 状态一致性校验
 *
 * 语义（方案v2 D1）：
 * - 未声明 / 空字符串 → 直接 return，维持现状（mock 短路，默认行为零变化）
 * - 声明 `real` → 要求全部策略 isMock=false，任一为 mock → throw（报错清单取 listMockPaymentStrategies()）
 * - 声明逗号分隔 method 列表（如 `COD,BANK_TRANSFER`）→ 校验列表内每个策略 isMock=false，不符 → throw
 *
 * 在 main.ts bootstrap（assertSmsStartupConfig 之后）调用，fail-fast。
 */
export function assertPaymentStrategyConsistent(
  env: string | undefined = process.env.PAYMENT_STRATEGY,
): void {
  const declared = env?.trim();
  if (!declared) return;

  const requested: PaymentMethodCode[] =
    declared.toLowerCase() === 'real'
      ? (Object.keys(STRATEGIES) as PaymentMethodCode[])
      : (declared
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean) as PaymentMethodCode[]);

  for (const method of requested) {
    const strategy = STRATEGIES[method];
    if (!strategy) {
      throw new Error(
        `PAYMENT_STRATEGY declared unknown payment method: ${method} (valid: ${Object.keys(STRATEGIES).join(',')}, or 'real')`,
      );
    }
    if (strategy.isMock) {
      const mockList = listMockPaymentStrategies()
        .map((s) => s.method)
        .join(',');
      throw new Error(
        `PAYMENT_STRATEGY=${declared} requires real strategies, but ${method} is still mock. ` +
          `Mock strategies present: [${mockList}]. Switch them to real implementations in code (payment.factory.ts registry) before declaring PAYMENT_STRATEGY.`,
      );
    }
  }
}

export * from './payment-strategy';
