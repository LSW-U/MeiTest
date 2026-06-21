/**
 * 订单号生成器（W1 完成判据：orderNo 生成器单测覆盖）
 *
 * 决策依据：
 * - CLAUDE.md §orderNo 格式（v0.3 决策 A）
 * - 契约 v0.3 决策 A：MM + yyyyMMdd(8) + warehouseId(2位) + 序号(4位) = 16 位
 *
 * 格式：MM + yyyyMMdd + WH(2) + SEQ(4)
 *   例：MM2026062001000234 = 2026-06-20, W01, 当日第 234 单
 *
 * 序号由 Redis INCR order:seq:{date}:{whCode} 生成（apps/api/order-no.service.ts）
 * 本文件提供纯函数格式化/解析/校验（不依赖 Redis）
 */

/** 订单号正则（16 位：MM + 8 数字日期 + 2 位仓库 + 4 位序号） */
export const ORDER_NO_REGEX = /^MM(\d{8})(\d{2})(\d{4})$/;

/** 订单号长度 */
export const ORDER_NO_LENGTH = 16;

/** 单仓单日序号上限（4 位最大值） */
export const MAX_DAILY_SEQ_PER_WAREHOUSE = 9999;

/** 订单号解析结果 */
export interface ParsedOrderNo {
  /** 原始 orderNo */
  raw: string;
  /** 日期 yyyyMMdd */
  date: string;
  /** 年 yyyy */
  year: string;
  /** 月 MM */
  month: string;
  /** 日 dd */
  day: string;
  /** 仓库代码 2 位（如 "01" = W01） */
  warehouseCode: string;
  /** 完整仓库代码（如 "W01"） */
  warehouseFullCode: string;
  /** 当日序号（如 234） */
  sequence: number;
}

/**
 * 格式化订单号
 *
 * @param date yyyyMMdd 格式（如 "20260620"）
 * @param warehouseCode 2 位数字字符串（如 "01"）
 * @param sequence 当日序号（1-9999）
 * @returns 16 位订单号（如 "MM2026062001000234"）
 *
 * @throws 参数非法时抛错
 */
export function formatOrderNo(date: string, warehouseCode: string, sequence: number): string {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`ORDER_NO_DATE_FORMAT: date must be 8 digits (yyyyMMdd), got "${date}"`);
  }
  if (!/^\d{2}$/.test(warehouseCode)) {
    throw new Error(
      `ORDER_NO_WAREHOUSE_CODE_FORMAT: warehouseCode must be 2 digits, got "${warehouseCode}"`,
    );
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_DAILY_SEQ_PER_WAREHOUSE) {
    throw new Error(
      `ORDER_NO_SEQUENCE_RANGE: sequence must be 1-${MAX_DAILY_SEQ_PER_WAREHOUSE}, got ${sequence}`,
    );
  }

  const seqStr = String(sequence).padStart(4, '0');
  return `MM${date}${warehouseCode}${seqStr}`;
}

/**
 * 解析订单号
 *
 * @param orderNo 16 位订单号
 * @returns ParsedOrderNo
 * @throws 格式非法时抛错
 */
export function parseOrderNo(orderNo: string): ParsedOrderNo {
  if (orderNo.length !== ORDER_NO_LENGTH) {
    throw new Error(`ORDER_NO_LENGTH: must be ${ORDER_NO_LENGTH} chars, got ${orderNo.length}`);
  }
  const match = ORDER_NO_REGEX.exec(orderNo);
  if (!match) {
    throw new Error(`ORDER_NO_FORMAT: invalid format "${orderNo}"`);
  }

  const [, date, whCode, seqStr] = match;
  return {
    raw: orderNo,
    date: date!,
    year: date!.slice(0, 4),
    month: date!.slice(4, 6),
    day: date!.slice(6, 8),
    warehouseCode: whCode!,
    warehouseFullCode: `W${whCode}`,
    sequence: Number(seqStr),
  };
}

/**
 * 校验订单号格式（不抛错，返回 boolean）
 */
export function isValidOrderNo(orderNo: string): boolean {
  return orderNo.length === ORDER_NO_LENGTH && ORDER_NO_REGEX.test(orderNo);
}

/**
 * Redis key 用于生成序号
 *
 * 调用方（apps/api）用法：
 *   const seq = await redis.incr(getOrderSeqKey(date, whCode));
 *   if (seq === 1) await redis.expire(getOrderSeqKey(date, whCode), 86400 * 2); // 2 天过期
 *   const orderNo = formatOrderNo(date, whCode, seq);
 *
 * @param date yyyyMMdd
 * @param whCode 2 位仓库代码
 * @returns Redis key（如 "order:seq:20260620:01"）
 */
export function getOrderSeqKey(date: string, whCode: string): string {
  return `order:seq:${date}:${whCode}`;
}
