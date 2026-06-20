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

const STRATEGIES: Record<PaymentMethodCode, PaymentStrategy> = {
  COD: new CodStrategy(),
  BANK_TRANSFER: new BankTransferStrategy(),
  WECHAT: new WechatStrategy(),
  PAYPAL: new PaypalStrategy(),
  STRIPE: new StripeStrategy(),
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

export * from './payment-strategy';
