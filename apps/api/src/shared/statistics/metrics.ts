/**
 * 统计口径常量单一事实源（数据分析报表模块 批A 2026-09-09）
 *
 * 从 platform/dashboard.service.ts 移入，dashboard 与 statistics（批B 起）共 import，
 * 防止报表与看板口径分叉（v2 §3.1 / 风险 2）。口径文档：wiki 执行手册/数据口径.md。
 *
 * 时间口径：所有统计时间过滤用 Dili 当地 0 点切日（见同目录 range.ts）。
 */

/**
 * 订单进入 GMV 统计的状态（已支付/已确认/配送中/已完成；排除待付款/取消/拒付/未确认）
 *
 * 2026-06-24 M2 修复：移除 DELIVERED_UNPAID（拒付不计入成交，否则 GMV 虚高）
 */
export const GMV_ORDER_STATUSES = [
  'CONFIRMED',
  'PICKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED_PAID',
  'DELIVERED',
  'COMPLETED',
] as const;

/** 异常订单状态 */
export const ABNORMAL_ORDER_STATUSES = ['CANCELLED', 'DELIVERED_UNPAID'] as const;

/** 超时未确认订单阈值（分钟） */
export const PENDING_TIMEOUT_MIN = 30;
