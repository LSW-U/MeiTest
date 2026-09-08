/**
 * 汇率静态配置（批A 汇率体系，微信支付预留 2026-09-08，方案V2 D4/D5）
 *
 * 风格对齐：参考 dispatch.config.ts / payment-methods.config.ts（静态配置集中管理，禁止硬编码散落）。
 *
 * 兜底口径（方案V2 风险 8）：当日无运营维护记录时回退固定值，客户端按 source=FALLBACK
 * 提示"按固定汇率估算"；显示/结算/对账的口径一致性由订单快照保证（D5），运营需在
 * 汇率波动时当日维护。
 */

/** 兜底汇率解析（环境变量 EXCHANGE_FALLBACK_RATE 可覆盖；配错不崩，回退默认值 7.2） */
function parseFallbackRate(): number {
  const raw = process.env.EXCHANGE_FALLBACK_RATE;
  if (!raw) return 7.2;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7.2;
}

/** 兜底汇率（当日无运营维护记录时使用，方案 D4 初值 7.2） */
export const EXCHANGE_FALLBACK_RATE = parseFallbackRate();

/** 汇率存储精度：万分位（7.2345 → 72345），避免浮点误差 */
export const RATE_SCALE = 10_000;

/**
 * 人民币结算通道集合（下单汇率快照触发口径，方案V2 §3.1 第 4 条）
 *
 * WECHAT_GLOBAL / ALIPAY_CN 枚举值批B 补位（方案V2 §3.2 第 1 条）；
 * 集合按 string 判定，批B 枚举落地后本配置零改动。
 */
export const CNY_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  'WECHAT',
  'WECHAT_GLOBAL',
  'ALIPAY_CN',
]);

/** 是否人民币结算通道（下单汇率快照触发判定） */
export function isCnyPaymentMethod(paymentMethod: string): boolean {
  return CNY_PAYMENT_METHODS.has(paymentMethod);
}

/** 十进制汇率 → 万分位整数（7.2345 → 72345；Math.round 吸收浮点误差 72344.999…） */
export function toRateInt(rate: number): number {
  return Math.round(rate * RATE_SCALE);
}

/** 万分位整数 → 十进制展示值（72345 → 7.2345） */
export function fromRateInt(rateInt: number): number {
  return rateInt / RATE_SCALE;
}

/**
 * 人民币估算金额（分）= USD 金额（分）× 万分位汇率 / 10000，四舍五入
 * 例：$10.00 = 1000 分，rate 72345 → 1000 × 72345 / 10000 = 7234.5 → 7235 分 = ¥72.35
 */
export function calcCnyAmount(usdCents: number, rateInt: number): number {
  return Math.round((usdCents * rateInt) / RATE_SCALE);
}
