/**
 * 支付方式静态配置（W7 P1-1 + 批B 枚举补位，微信支付预留 2026-09-08，方案V2 §3.2）
 *
 * 8 种支付方式的多语言 name/subtitle/icon/isDefault/enabled/available 配置。
 * mockFlag 从 strategy.isMock 派生（运行时取），其他字段在此静态配置。
 *
 * 设计：
 *   - 多语言 JSON 与 Product.name 同模式（Record<string, string>）
 *   - 前端按 Accept-Language 取值展示
 *   - isDefault: COD 是东帝汶默认方式（无支付基础设施）
 *   - enabled: MVP 全开，未来可接 SystemConfig 动态控制
 *   - available（批B 新增）：false = 占位渠道——列表可见"即将上线"但不可选中，
 *     createOrder 服务端拒绝（R2，E-PAYMENT-011）；enabled=false 则连列表都不出
 *
 * 渠道语义（批B 固化）：
 *   - WECHAT = 微信支付（国内，中国主体商户号，接口预留，mock 可跑通流程）
 *   - WECHAT_GLOBAL = 国际版微信——东帝汶不受理（跨境 49 国名单不含），仅占位
 *   - ALIPAY_CN = 支付宝（中国主体，接口预留）
 *   - LOCAL_PSP = 东帝汶本地支付服务商（W6 后调研接入）
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
  /** 是否可下单（批B：false = 占位渠道，列表展示"即将上线"，服务端拒绝下单） */
  available: boolean;
}

/** 8 种支付方式静态配置（按推荐顺序；3 占位渠道排尾） */
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
    available: true,
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
    available: true,
  },
  {
    code: 'WECHAT',
    name: {
      en: 'WeChat Pay',
      zh: '微信支付（国内）',
      id: 'WeChat Pay',
      pt: 'WeChat Pay',
      tet: 'WeChat Pay',
    },
    subtitle: {
      en: 'WeChat Pay (mainland China merchant account, reserved; test mode)',
      zh: '微信支付（国内，中国主体商户号，接口预留；当前为测试模式）',
      id: 'Bayar via aplikasi WeChat (merchant Tiongkok, mode uji)',
      pt: 'Pagar via aplicativo WeChat (merchant da China, em modo de teste)',
      tet: 'Paga liu husi aplikasaun WeChat (merchant Xina, mode teste)',
    },
    icon: 'wechat',
    isDefault: false,
    enabled: true,
    available: true,
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
    available: true,
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
    available: true,
  },
  {
    code: 'WECHAT_GLOBAL',
    // 占位渠道：东帝汶不受理（微信跨境 49 国名单不含），列表可见"即将上线"，下单拒绝
    name: {
      en: 'WeChat Pay (Global)',
      zh: '微信支付（国际版）',
      id: 'WeChat Pay (Global)',
      pt: 'WeChat Pay (Global)',
      tet: 'WeChat Pay (Global)',
    },
    subtitle: {
      en: 'Not accepted in Timor-Leste — placeholder for future coverage',
      zh: '东帝汶不受理，仅占位（国际版微信预留）',
      id: 'Belum tersedia di Timor-Leste — placeholder',
      pt: 'Não aceito em Timor-Leste — espaço reservado',
      tet: 'Seidauk aceita iha Timor-Leste — rezerva deit',
    },
    icon: 'wechat-global',
    isDefault: false,
    enabled: true,
    available: false,
  },
  {
    code: 'ALIPAY_CN',
    // 占位渠道：支付宝（中国主体）接口预留，资质（C5）挂账，下单拒绝
    name: {
      en: 'Alipay',
      zh: '支付宝',
      id: 'Alipay',
      pt: 'Alipay',
      tet: 'Alipay',
    },
    subtitle: {
      en: 'Alipay (China) — coming soon',
      zh: '支付宝（中国主体，接口预留）— 即将上线',
      id: 'Alipay (Tiongkok) — segera hadir',
      pt: 'Alipay (China) — brevemente disponível',
      tet: 'Alipay (Xina) —sei mai kedas',
    },
    icon: 'alipay',
    isDefault: false,
    enabled: true,
    available: false,
  },
  {
    code: 'LOCAL_PSP',
    // 占位渠道：东帝汶本地支付服务商，W6 后调研接入（C6 挂账），下单拒绝
    name: {
      en: 'Local payment',
      zh: '本地支付',
      id: 'Pembayaran lokal',
      pt: 'Pagamento local',
      tet: 'Pagamentu lokal',
    },
    subtitle: {
      en: 'Timor-Leste local payment provider — coming soon',
      zh: '东帝汶本地支付服务商 — 即将上线',
      id: 'Penyedia pembayaran lokal Timor-Leste — segera hadir',
      pt: 'Operador de pagamentos local de Timor-Leste — brevemente',
      tet: 'Prestador pagamentu lokal Timor-Leste — sei mai kedas',
    },
    icon: 'local-psp',
    isDefault: false,
    enabled: true,
    available: false,
  },
];

/**
 * 渠道是否可下单（批B R2 下单校验判定，order.service Step 0 调用）
 *
 * 三条全过才可下单：渠道在 config + enabled + available。
 * 渠道不在 config（理论被契约 zod 挡住，防御直调）或 available=false（占位渠道）→ false。
 */
export function isPaymentMethodOrderable(code: string): boolean {
  const cfg = PAYMENT_METHODS_CONFIG.find((c) => c.code === code);
  return !!cfg && cfg.enabled && cfg.available;
}
