/**
 * 汇率模块 schema（批A 汇率体系，微信支付预留 2026-09-08）
 *
 * 决策依据（方案V2 §3.1）：
 * - D4：运营每日汇率表 + 固定汇率兜底（当日无表回退固定值，不接实时汇率服务）
 * - D5：下单时锁汇率进订单快照（显示/结算/对账三者一致）
 *
 * 单位口径：
 * - 存储侧 rate 为万分位整数（7.2345 → 72345），避免浮点误差
 * - API 请求输入 rate 为十进制（如 7.2345），服务端转万分位落库
 * - API 响应同时输出 rate（万分位）与 rateDecimal（十进制展示值）
 *
 * MVP 仅 USD→CNY；扩币种对时放宽 fromCurrency/toCurrency 约束即可。
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

/** 汇率来源：OPERATOR = 运营当日维护 / FALLBACK = 当日无表，回退固定值 */
export const ExchangeRateSource = z.enum(['OPERATOR', 'FALLBACK']);
export type ExchangeRateSourceValue = z.infer<typeof ExchangeRateSource>;

/** 生效日期 YYYY-MM-DD（Asia/Dili 业务日） */
export const RateDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'rateDate must be YYYY-MM-DD');
export type RateDateValue = z.infer<typeof RateDate>;

/** 汇率万分位整数（7.2345 → 72345） */
export const RateInt = z.number().int().positive();

/** 汇率记录视图（admin 历史列表项 / upsert 响应） */
export const ExchangeRateView = z.object({
  id: Id,
  rateDate: RateDate,
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  /** 万分位整数：7.2345 → 72345 */
  rate: RateInt,
  /** 十进制展示值 = rate / 10000 */
  rateDecimal: z.number().positive(),
  source: ExchangeRateSource,
  operatorId: Id.nullable(),
  createdAt: IsoTimestamp,
});

/** admin 维护请求（按日 upsert；rate 为十进制，如 7.2345，服务端转万分位落库） */
export const UpsertExchangeRateRequest = z.object({
  rateDate: RateDate,
  /** 汇率（十进制，合理区间 (0, 10000) 开区间——P3-3 与 service `rate >= 10000` 拒绝对齐） */
  rate: z.number().positive().lt(10000),
});

/** admin upsert 响应 */
export const UpsertExchangeRateResponseData = z.object({
  rate: ExchangeRateView,
});

/** client 查询请求（MVP 仅支持 CNY；其余值 400 拒绝） */
export const ClientExchangeRateQuery = z.object({
  to: z.enum(['CNY']).default('CNY'),
});

/** client 查询响应（当日生效汇率；source=FALLBACK 时前端应提示"按固定汇率估算"） */
export const ClientExchangeRateResponseData = z.object({
  rateDate: RateDate,
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  /** 万分位整数 */
  rate: RateInt,
  /** 十进制展示值 = rate / 10000 */
  rateDecimal: z.number().positive(),
  source: ExchangeRateSource,
});

/** admin 历史列表查询（生效日期倒序 + 游标分页，游标为上一页最后一条的 rateDate） */
export const ListExchangeRatesQuery = z.object({
  /** 过滤：生效日期下界（含，YYYY-MM-DD） */
  startDate: RateDate.optional(),
  /** 过滤：生效日期上界（含，YYYY-MM-DD） */
  endDate: RateDate.optional(),
  /** 游标：返回早于该日期的记录 */
  cursor: RateDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** admin 历史列表响应 */
export const ExchangeRateListResponseData = z.object({
  items: z.array(ExchangeRateView),
  /** 下一页游标（null = 已到最早记录） */
  nextCursor: z.string().nullable(),
});
