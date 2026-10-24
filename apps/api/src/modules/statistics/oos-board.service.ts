/**
 * OosBoardService — admin 缺货看板只读聚合（缺货履约闭环批4 2026-10-24 · A5）
 *
 * 铁律（任务书批4）：只读聚合，不动 RealOrderAggregator / Settlement / statistics 既有口径——
 * 独立轻 service，不注入既有聚合器，raw SQL 自持。
 *
 * 三指标口径（数据源表/字段，模块收尾文档 §三指标口径同步）：
 *   1. 登记率 = reportedOrderCount / fulfilledOrderCount
 *      - 履约订单：orders.status ∈ GMV_ORDER_STATUSES（六态，metrics.ts 单源）
 *        **或** 全缺取消单（status='CANCELLED' 且 cancel_reason='OUT_OF_STOCK'，批4 审查 P2-1
 *        方案1 裁决：全缺订单被 CANCELLED 踢出分母会高估登记率，纳入后分子⊆分母、率恒≤1）
 *        且 created_at ∈ range
 *      - 有缺货登记：任一 order_items.out_of_stock_qty IS NOT NULL（D18：字段永久保留，
 *        两账分离——登记事实锚 Order.createdAt，不锚登记时间，保证与履约分母同窗可比）
 *   2. 自动退款率 = systemRefundCount / oosRefundCount
 *      - OUT_OF_STOCK 退款：refunds.reason='OUT_OF_STOCK' 且 created_at ∈ range，**全 status 计入**
 *        （分母是"引擎建了多少单"，CANCELLED/FAILED 也占用过引擎决策，不剔除——口径见收尾文档）
 *      - system 退款：refunds.reviewed_by='SYSTEM'（D9b 通路标记，direct 直退 + 超限 PENDING 均含）
 *   3. 人工介入率 = pendingCount / oosRefundCount
 *      - PENDING 人工队列：refunds.status='PENDING' 的 OUT_OF_STOCK 退款
 *        （含超限转人工 D17 + 复审新建人工单 D9b-dispute，全部"等人工决策"的单，A5 可观测）
 *   - 分母 0 → 对应 rate = null（批D/E 同范式）
 *   - trend：按日切桶锚定 refunds.created_at（Dili 当地日切，同 settlements period_date 切法）；
 *     登记数无独立登记时间戳字段（登记事件写 order_events 但聚合成本高），trend.reported
 *     锚 Order.created_at（与登记率同锚，保持口径自洽）
 *
 * 规则表变更留痕（D15）：不在本 service——规则写入口（PUT /admin/orders/out-of-stock-rule）
 * 已挂 @Audit(resource='OutOfStockRule') 写 AuditLog + 引擎 OOS_RULE_UPDATED 结构化日志，
 * 看板只读不重复建设。
 *
 * 性能：refunds 三桶一条 SQL（reason+reviewed_by+status 一次 CASE 聚合，吃 refunds_status_created_at_idx）；
 *       履约/登记两条轻 SQL（orders [status,created_at] + order_items [order_id] 索引）。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { buildRange } from '../../shared/statistics/range';
import { GMV_ORDER_STATUSES } from '../../shared/statistics/metrics';

/** 缺货看板聚合入参（controller 已过 Zod 校验） */
export interface OosBoardParams {
  range?: 'today' | 'week' | 'month';
  from?: string;
  to?: string;
}

/** GMV 状态集合 SQL IN 字面量（metrics 单源展开，同 statistics.service 范式） */
const GMV_STATUSES_SQL = Prisma.join(
  [...GMV_ORDER_STATUSES].map((s) => Prisma.sql`${s}`),
);

@Injectable()
export class OosBoardService {
  /**
   * 缺货看板三指标 + 按日趋势（A5）
   *
   * 契约：StatisticsOosData（api-contract/schemas/statistics.ts 批4 节）
   */
  async getOosBoard(params: OosBoardParams): Promise<{
    from: string;
    to: string;
    fulfilledOrderCount: number;
    reportedOrderCount: number;
    reportRate: number | null;
    oosRefundCount: number;
    systemRefundCount: number;
    autoRefundRate: number | null;
    pendingCount: number;
    manualInterventionRate: number | null;
    trend: Array<{ date: string; reported: number; oosRefunds: number; systemRefunds: number }>;
  }> {
    // 时间范围校验/切日全部由批A 公共层负责（E-STATISTICS-001/002 在此抛出）
    const r =
      params.range !== undefined
        ? buildRange(params.range)
        : buildRange({ from: params.from as string, to: params.to as string });

    // 1) 履约订单数（登记率分母）：GMV 六态 + 全缺取消单（P2-1 方案1）+ createdAt ∈ range
    //    全缺 CANCELLED（cancel_reason='OUT_OF_STOCK'）本质是"履约后全缺退单"，
    //    纳入分母保证登记分子 ⊆ 分母（率恒≤1）
    const fulfilledRows = await db.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM orders o
      WHERE (
          o.status::text IN (${GMV_STATUSES_SQL})
          OR (o.status::text = 'CANCELLED' AND o.cancel_reason::text = 'OUT_OF_STOCK')
        )
        AND o.created_at >= ${r.from}::timestamptz
        AND o.created_at < ${r.to}::timestamptz
    `;

    // 2) 有缺货登记订单数（登记率分子）：任一项 out_of_stock_qty 非空；
    //    锚 Order.created_at（与分母同窗可比，D18 字段永久保留不清）
    const reportedRows = await db.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(DISTINCT oi.order_id)::bigint AS cnt
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE oi.out_of_stock_qty IS NOT NULL
        AND o.created_at >= ${r.from}::timestamptz
        AND o.created_at < ${r.to}::timestamptz
    `;

    // 3) 退款三桶一条 SQL：OUT_OF_STOCK 全 status / reviewed_by='SYSTEM' / status='PENDING'
    //    吃 refunds_status_created_at_idx（批D 同款）
    const refundRows = await db.$queryRaw<
      Array<{ total: bigint; system_cnt: bigint; pending_cnt: bigint }>
    >`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE rf.reviewed_by = 'SYSTEM')::bigint AS system_cnt,
             COUNT(*) FILTER (WHERE rf.status = 'PENDING')::bigint AS pending_cnt
      FROM refunds rf
      WHERE rf.reason::text = 'OUT_OF_STOCK'
        AND rf.created_at >= ${r.from}::timestamptz
        AND rf.created_at < ${r.to}::timestamptz
    `;

    // 4) 按日趋势：Dili 当地日切桶（同 getRiders period_date 切法——AT TIME ZONE 'Asia/Dili'
    //    切回墙钟再取 date，禁服务器时区直接 ::date）。登记数锚 Order.created_at，退款锚 Refund.created_at
    const trendRows = await db.$queryRaw<
      Array<{ d: string; reported: bigint; oos_refunds: bigint; system_refunds: bigint }>
    >`
      WITH days AS (
        SELECT generate_series(
          (${r.from} AT TIME ZONE 'Asia/Dili')::date,
          (${r.to} AT TIME ZONE 'Asia/Dili')::date,
          INTERVAL '1 day'
        )::date AS d
      ),
      refund_daily AS (
        SELECT (rf.created_at AT TIME ZONE 'Asia/Dili')::date AS d,
               COUNT(*)::bigint AS oos_refunds,
               COUNT(*) FILTER (WHERE rf.reviewed_by = 'SYSTEM')::bigint AS system_refunds
        FROM refunds rf
        WHERE rf.reason::text = 'OUT_OF_STOCK'
          AND rf.created_at >= ${r.from}::timestamptz
          AND rf.created_at < ${r.to}::timestamptz
        GROUP BY 1
      ),
      report_daily AS (
        SELECT (o.created_at AT TIME ZONE 'Asia/Dili')::date AS d,
               COUNT(DISTINCT oi.order_id)::bigint AS reported
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE oi.out_of_stock_qty IS NOT NULL
          AND o.created_at >= ${r.from}::timestamptz
          AND o.created_at < ${r.to}::timestamptz
        GROUP BY 1
      )
      SELECT days.d::text AS d,
             COALESCE(rd.reported, 0)::bigint AS reported,
             COALESCE(fd.oos_refunds, 0)::bigint AS oos_refunds,
             COALESCE(fd.system_refunds, 0)::bigint AS system_refunds
      FROM days
      LEFT JOIN refund_daily fd ON fd.d = days.d
      LEFT JOIN report_daily rd ON rd.d = days.d
      ORDER BY days.d
    `;

    const fulfilledOrderCount = Number(fulfilledRows[0]?.cnt ?? 0);
    const reportedOrderCount = Number(reportedRows[0]?.cnt ?? 0);
    const oosRefundCount = Number(refundRows[0]?.total ?? 0);
    const systemRefundCount = Number(refundRows[0]?.system_cnt ?? 0);
    const pendingCount = Number(refundRows[0]?.pending_cnt ?? 0);

    return {
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      fulfilledOrderCount,
      reportedOrderCount,
      // 分母 0（区间内无履约订单）→ 率无意义，置 null
      reportRate: fulfilledOrderCount === 0 ? null : reportedOrderCount / fulfilledOrderCount,
      oosRefundCount,
      systemRefundCount,
      autoRefundRate: oosRefundCount === 0 ? null : systemRefundCount / oosRefundCount,
      pendingCount,
      manualInterventionRate: oosRefundCount === 0 ? null : pendingCount / oosRefundCount,
      trend: trendRows.map((row) => ({
        date: row.d,
        reported: Number(row.reported),
        oosRefunds: Number(row.oos_refunds),
        systemRefunds: Number(row.system_refunds),
      })),
    };
  }
}
