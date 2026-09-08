/**
 * Rate Service — 汇率核心逻辑（批A 汇率体系，微信支付预留 2026-09-08，方案V2 §3.1 / D4+D5）
 *
 * 决策依据：
 * - D4：运营每日汇率表 + 固定汇率兜底（不接实时汇率服务）
 * - D5：下单时锁汇率进订单快照（显示/结算/对账三者一致）；本地用户纯 USD 零影响
 *
 * 设计要点：
 * - rate 全链路万分位整数存储（RATE_SCALE=10000，7.2345 → 72345）；API 层同时输出 rateDecimal 展示值
 * - 业务日按 Asia/Dili（shared/datetime），与 orderNo / settle T+1 同口径
 * - 兜底值来自 rate.config.ts EXCHANGE_FALLBACK_RATE（env 可覆盖），兜底不入库，仅查询时标记 source=FALLBACK
 * - 下单快照钩子（resolveOrderEffectiveRate / buildOrderRateFields）以模块级函数导出，
 *   order.service 直接 import 复用（同 shared/db 的 deductStock 模式，不改 Order 构造器 DI，无循环依赖）
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { getDaysAgoInTz, isValidDateString } from '../../shared/datetime';
import { logger } from '../../shared/logger/logger';
import {
  EXCHANGE_FALLBACK_RATE,
  CNY_PAYMENT_METHODS,
  fromRateInt,
  toRateInt,
  calcCnyAmount,
} from './rate.config';

/** 当日生效汇率视图（client 查询 / 下单快照共用） */
export interface EffectiveRate {
  /** 生效日期 YYYY-MM-DD（Asia/Dili 业务日） */
  rateDate: string;
  fromCurrency: string;
  toCurrency: string;
  /** 万分位整数（7.2345 → 72345） */
  rate: number;
  /** 十进制展示值 = rate / RATE_SCALE */
  rateDecimal: number;
  /** OPERATOR = 运营当日维护 / FALLBACK = 当日无表回退固定值 */
  source: 'OPERATOR' | 'FALLBACK';
}

/** admin 汇率记录视图（历史列表项 / upsert 响应） */
export interface ExchangeRateView extends EffectiveRate {
  id: string;
  operatorId: string | null;
  createdAt: string;
}

/** 业务日期字符串 → UTC 零点 Date（对齐 @db.Date 存储口径） */
export function rateDateToUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** ExchangeRate 行 → 视图（万分位 → 十进制展示值） */
function toView(row: {
  id: string;
  rateDate: Date;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source: string;
  operatorId: string | null;
  createdAt: Date;
}): ExchangeRateView {
  return {
    id: row.id,
    rateDate: row.rateDate.toISOString().slice(0, 10),
    fromCurrency: row.fromCurrency,
    toCurrency: row.toCurrency,
    rate: row.rate,
    rateDecimal: fromRateInt(row.rate),
    source: row.source as ExchangeRateView['source'],
    operatorId: row.operatorId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 查询当日生效汇率（Asia/Dili 业务日）
 *
 * 当日无表 → 回退 EXCHANGE_FALLBACK_RATE 并标记 source=FALLBACK（方案V2 D4 + 风险 8，
 * 前端据 FALLBACK 提示"按固定汇率估算"）
 */
export async function getEffectiveRate(toCurrency = 'CNY'): Promise<EffectiveRate> {
  const rateDate = getDaysAgoInTz(0); // 当日（Asia/Dili）
  const fromCurrency = 'USD';
  const row = await db.exchangeRate.findUnique({
    where: {
      rateDate_fromCurrency_toCurrency: {
        rateDate: rateDateToUtc(rateDate),
        fromCurrency,
        toCurrency,
      },
    },
  });
  if (row) {
    return {
      rateDate,
      fromCurrency,
      toCurrency,
      rate: row.rate,
      rateDecimal: fromRateInt(row.rate),
      source: 'OPERATOR',
    };
  }
  const fallbackRate = toRateInt(EXCHANGE_FALLBACK_RATE);
  logger.warn({
    msg: 'EXCHANGE_RATE_FALLBACK',
    rateDate,
    fromCurrency,
    toCurrency,
    fallbackRateDecimal: fromRateInt(fallbackRate),
  });
  return {
    rateDate,
    fromCurrency,
    toCurrency,
    rate: fallbackRate,
    rateDecimal: fromRateInt(fallbackRate),
    source: 'FALLBACK',
  };
}

/**
 * 下单汇率快照解析（createOrder 钩子，批A）
 *
 * 人民币通道（WECHAT/WECHAT_GLOBAL/ALIPAY_CN）→ 取当日生效汇率（兜底逻辑同 client 查询）；
 * 其余通道 → 返回 null 且**不查库**（本地用户纯 USD 零影响，方案V2 §3.1 第 4 条）。
 * WECHAT_GLOBAL / ALIPAY_CN 枚举值批B 补位，此处按字符串集合判定，批B 落地零改动。
 */
export async function resolveOrderEffectiveRate(paymentMethod: string): Promise<EffectiveRate | null> {
  if (!CNY_PAYMENT_METHODS.has(paymentMethod)) return null;
  return getEffectiveRate('CNY');
}

/**
 * 组装 order.create 的汇率快照字段（纯函数，便于单测）
 *
 * estimatedCnyAmount = payableAmount（分）× rate（万分位）/ 10000，四舍五入；
 * 非人民币通道（effective=null）两字段均 null。
 */
export function buildOrderRateFields(
  payableAmount: number,
  effective: EffectiveRate | null,
): { exchangeRate: number | null; estimatedCnyAmount: number | null } {
  return {
    exchangeRate: effective?.rate ?? null,
    estimatedCnyAmount: effective ? calcCnyAmount(payableAmount, effective.rate) : null,
  };
}

/** admin 维护汇率入参（rate 为十进制，如 7.2345，服务端转万分位落库） */
export interface UpsertRateInput {
  /** 生效日期 YYYY-MM-DD（Asia/Dili 业务日） */
  rateDate: string;
  rate: number;
  /** 录入人（SUPER_ADMIN user.id） */
  operatorId: string;
}

/**
 * 运营维护汇率（按日 upsert，SUPER_ADMIN；方案V2 A2）
 *
 * 校验：rateDate 必须为真实日历日（zod 正则只挡格式，V8 对 02-30 宽容解析需 round-trip 复核）；
 * rate 合理区间 (0, 10000)（controller zod 已挡，service 兜底防直调）。
 */
export async function upsertRate(input: UpsertRateInput): Promise<ExchangeRateView> {
  const { rateDate, rate, operatorId } = input;
  if (!isValidDateString(rateDate)) {
    throw new BadRequestException({
      code: 'E-RATE-002',
      message: 'rateDate must be a valid calendar date (YYYY-MM-DD)',
    });
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 10000) {
    throw new BadRequestException({
      code: 'E-RATE-001',
      message: 'rate must be a positive number below 10000',
    });
  }
  const fromCurrency = 'USD';
  const toCurrency = 'CNY';
  const rateInt = toRateInt(rate);
  const row = await db.exchangeRate.upsert({
    where: {
      rateDate_fromCurrency_toCurrency: {
        rateDate: rateDateToUtc(rateDate),
        fromCurrency,
        toCurrency,
      },
    },
    create: {
      rateDate: rateDateToUtc(rateDate),
      fromCurrency,
      toCurrency,
      rate: rateInt,
      source: 'OPERATOR',
      operatorId,
    },
    update: {
      rate: rateInt,
      source: 'OPERATOR',
      operatorId,
    },
  });
  logger.info({
    msg: 'EXCHANGE_RATE_UPSERTED',
    rateDate,
    fromCurrency,
    toCurrency,
    rateDecimal: fromRateInt(rateInt),
    operatorId,
  });
  return toView(row);
}

/** admin 汇率历史查询入参（生效日期倒序 + 游标分页） */
export interface ListRatesParams {
  startDate?: string;
  endDate?: string;
  /** 游标：返回早于该日期的记录（上一页最后一条的 rateDate） */
  cursor?: string;
  limit?: number;
}

/** admin 汇率历史（方案V2 A2 列表/历史；MVP 固定 USD→CNY，rateDate 唯一故游标取 rateDate 即可） */
export async function listRates(
  params: ListRatesParams = {},
): Promise<{ items: ExchangeRateView[]; nextCursor: string | null }> {
  // P3-1（审查修复）：startDate/endDate/cursor 复用 round-trip 日历校验——zod 正则挡不住
  // 2026-02-30（V8 静默滚动为 03-02），不挡会"看似 200 成功、实际按滚动后日期过滤"
  const dateParams: [string, string | undefined][] = [
    ['startDate', params.startDate],
    ['endDate', params.endDate],
    ['cursor', params.cursor],
  ];
  for (const [key, value] of dateParams) {
    if (value !== undefined && !isValidDateString(value)) {
      throw new BadRequestException({
        code: 'E-RATE-002',
        message: `${key} must be a valid calendar date (YYYY-MM-DD)`,
      });
    }
  }

  const limit = params.limit ?? 20;
  const where: Prisma.ExchangeRateWhereInput = {
    fromCurrency: 'USD',
    toCurrency: 'CNY',
  };
  const dateFilter: Prisma.DateTimeFilter = {};
  if (params.startDate) dateFilter.gte = rateDateToUtc(params.startDate);
  if (params.endDate) dateFilter.lte = rateDateToUtc(params.endDate);
  if (params.cursor) dateFilter.lt = rateDateToUtc(params.cursor);
  if (Object.keys(dateFilter).length > 0) where.rateDate = dateFilter;

  const rows = await db.exchangeRate.findMany({
    where,
    orderBy: [{ rateDate: 'desc' }, { fromCurrency: 'asc' }, { toCurrency: 'asc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toView);
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].rateDate : null,
  };
}

/**
 * RateService — DI 壳（controller 注入用），逻辑在模块级函数（供 order.service 免 DI 复用）
 */
@Injectable()
export class RateService {
  /** 当日生效汇率（含 FALLBACK 兜底标记） */
  getEffectiveRate(toCurrency?: string): Promise<EffectiveRate> {
    return getEffectiveRate(toCurrency);
  }

  /** 运营维护（按日 upsert） */
  upsertRate(input: UpsertRateInput): Promise<ExchangeRateView> {
    return upsertRate(input);
  }

  /** 汇率历史（游标分页） */
  listRates(params?: ListRatesParams) {
    return listRates(params);
  }
}
