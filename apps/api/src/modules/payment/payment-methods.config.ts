/**
 * 支付方式静态配置（W7 P1-1）
 *
 * 5 种支付方式的多语言 name/subtitle/icon/isDefault/enabled 配置。
 * mockFlag 从 strategy.isMock 派生（运行时取），其他字段在此静态配置。
 *
 * 设计：
 *   - 多语言 JSON 与 Product.name 同模式（Record<string, string>）
 *   - 前端按 Accept-Language 取值展示
 *   - isDefault: COD 是东帝汶默认方式（无支付基础设施）
 *   - enabled: MVP 全开，未来可接 SystemConfig 动态控制
 */
import type { PaymentMethodCode } from '../../infrastructure';

export interface PaymentMethodConfig {
  code: PaymentMethodCode;
  name: Record<string, string>;
  subtitle: Record<string, string>;
  /** 图标标识（前端按 code 渲染本地资源） */
  icon: string;
  /** 是否为默认方式（前端列表默认选中） */
  isDefault: boolean;
  /** 是否启用（false 时不在列表展示，但已下订单仍可查历史） */
  enabled: boolean;
}

/** 5 种支付方式静态配置（按推荐顺序） */
export const PAYMENT_METHODS_CONFIG: PaymentMethodConfig[] = [
  {
    code: 'COD',
    name: {
      en: 'Cash on delivery',
      zh: '货到付款',
      id: 'Bayar di tempat',
      pt: 'Pagamento na entrega',
      tet: 'Paga iha entrega',
    },
    subtitle: {
      en: 'Pay with cash when your order arrives',
      zh: '骑手送达时用现金支付',
      id: 'Bayar tunai saat pesanan tiba',
      pt: 'Pague em dinheiro na entrega',
      tet: "Paga ho osan-boot bainhira encomenda to'o",
    },
    icon: 'cod',
    isDefault: true,
    enabled: true,
  },
  {
    code: 'BANK_TRANSFER',
    name: {
      en: 'Bank transfer',
      zh: '银行转账',
      id: 'Transfer bank',
      pt: 'Transferência bancária',
      tet: 'Transferénsia bank',
    },
    subtitle: {
      en: 'Transfer to our bank account and upload receipt',
      zh: '转账到我方银行账户并上传凭证',
      id: 'Transfer ke rekening bank kami dan unggah bukti',
      pt: 'Transfira para nossa conta bancária e envie o comprovante',
      tet: 'Transfer ba konta bank ami no upload rezibu',
    },
    icon: 'bank',
    isDefault: false,
    enabled: true,
  },
  {
    code: 'WECHAT',
    name: {
      en: 'WeChat Pay',
      zh: '微信支付',
      id: 'WeChat Pay',
      pt: 'WeChat Pay',
      tet: 'WeChat Pay',
    },
    subtitle: {
      en: 'Pay via WeChat app (currently in test mode)',
      zh: '通过微信 App 支付（当前为测试模式）',
      id: 'Bayar via aplikasi WeChat (sedang mode uji)',
      pt: 'Pagar via aplicativo WeChat (em modo de teste)',
      tet: 'Paga liu husi aplikasaun WeChat (aga mode teste)',
    },
    icon: 'wechat',
    isDefault: false,
    enabled: true,
  },
  {
    code: 'PAYPAL',
    name: {
      en: 'PayPal',
      zh: 'PayPal',
      id: 'PayPal',
      pt: 'PayPal',
      tet: 'PayPal',
    },
    subtitle: {
      en: 'Pay with your PayPal account (currently in test mode)',
      zh: '使用 PayPal 账户支付（当前为测试模式）',
      id: 'Bayar dengan akun PayPal (sedang mode uji)',
      pt: 'Pague com sua conta PayPal (em modo de teste)',
      tet: 'Paga ho konta PayPal (aga mode teste)',
    },
    icon: 'paypal',
    isDefault: false,
    enabled: true,
  },
  {
    code: 'STRIPE',
    name: {
      en: 'Stripe',
      zh: 'Stripe',
      id: 'Stripe',
      pt: 'Stripe',
      tet: 'Stripe',
    },
    subtitle: {
      en: 'Pay with credit/debit card via Stripe (currently in test mode)',
      zh: '通过 Stripe 用信用卡 / 借记卡支付（当前为测试模式）',
      id: 'Bayar dengan kartu via Stripe (sedang mode uji)',
      pt: 'Pague com cartão via Stripe (em modo de teste)',
      tet: 'Paga ho kartun liu husi Stripe (aga mode teste)',
    },
    icon: 'stripe',
    isDefault: false,
    enabled: true,
  },
];
