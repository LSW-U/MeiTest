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

export * from './payment-strategy';
