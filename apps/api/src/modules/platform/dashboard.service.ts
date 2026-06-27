/**
 * Dashboard Service（平台数据看板聚合）
 *
 * 决策依据：W-M-C-T 流程 3 W2 — platform M1 C1
 *
 * MVP 阶段（W2-W5）数据策略：
 *   - GMV：用 Order.payableAmount 良性状态聚合（payment 数据 W5 切真，当前用订单估算）
 *   - 在线骑手：Redis `rider:online:{riderId}` SETEX 60s（由 rider.service heartbeat 维护）
 *   - 异常订单：CANCELLED + DELIVERED_UNPAID（拒付）+ 超时未确认（30 分钟）
 *   - growthPct：与上一周期对比
 *
 * 性能：所有聚合用 Prisma groupBy + 索引扫描，避免 N+1。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { buildRange, growthPct, type Range } from './platform-time';
import type {
  DashboardTimeRangeType,
  TrendPointType,
  WarehouseBreakdownItemType,
} from '@meimart/api-contract';

/**
 * 订单进入 GMV 统计的状态（已支付/已确认/配送中/已完成；排除待付款/取消/拒付/未确认）
 *
 * 2026-06-24 M2 修复：移除 DELIVERED_UNPAID（拒付不计入成交，否则 GMV 虚高）
 */
const GMV_ORDER_STATUSES = [
  'CONFIRMED',
  'PICKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED_PAID',
  'DELIVERED',
  'COMPLETED',
] as const;

/** 异常订单状态 */
const ABNORMAL_ORDER_STATUSES = ['CANCELLED', 'DELIVERED_UNPAID'] as const;

/** 超时未确认订单阈值（分钟） */
const PENDING_TIMEOUT_MIN = 30;

@Injectable()
export class DashboardService {
  async getSummary(range: DashboardTimeRangeType) {
    const r = buildRange(range);
    const now = new Date();

    const [currentAgg, prevAgg, onlineRiderCount, abnormalCount, trendAgg, warehouseAgg] =
      await Promise.all([
        this.aggregateGmvAndOrders(r.from, r.to),
        this.aggregateGmvAndOrders(r.prevFrom, r.prevTo),
        this.countOnlineRiders(now),
        this.countAbnormalOrders(now, r),
        this.aggregateTrend(r),
        this.aggregateWarehouseBreakdown(r.from, r.to),
      ]);

    return {
      range,
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      gmv: currentAgg.gmv,
      gmvGrowthPct: growthPct(currentAgg.gmv, prevAgg.gmv),
      orderCount: currentAgg.orderCount,
      orderCountGrowthPct: growthPct(currentAgg.orderCount, prevAgg.orderCount),
      onlineRiderCount,
      abnormalOrderCount: abnormalCount,
      trend: trendAgg,
      warehouseBreakdown: warehouseAgg,
    };
  }

  private async aggregateGmvAndOrders(from: Date, to: Date) {
    const rows = await db.order.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: from, lt: to },
        status: { in: [...GMV_ORDER_STATUSES] },
      },
      _sum: { payableAmount: true },
      _count: { _all: true },
    });
    const gmv = rows.reduce((acc, r) => acc + (r._sum.payableAmount ?? 0), 0);
    const orderCount = rows.reduce((acc, r) => acc + r._count._all, 0);
    return { gmv, orderCount };
  }

  private async countOnlineRiders(now: Date): Promise<number> {
    // P0-2 修复：改查 Redis（rider:online:{riderId} SETEX 60s，由 rider.service heartbeat 维护）
    // P1-NEW 修复（验证报告 §2）：redis.keys → SCAN 游标迭代（避免阻塞 Redis 单线程）
    void now;
    try {
      let count = 0;
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(
          cursor,
          'MATCH',
          'rider:online:*',
          'COUNT',
          100,
        );
        cursor = next;
        count += batch.length;
      } while (cursor !== '0');
      return count;
    } catch (e) {
      logger.warn({
        msg: 'DASHBOARD_ONLINE_RIDERS_REDIS_FAILED',
        error: (e as Error).message,
      });
      return 0;
    }
  }

  private async countAbnormalOrders(now: Date, range: Range): Promise<number> {
    const pendingCutoff = new Date(now.getTime() - PENDING_TIMEOUT_MIN * 60 * 1000);
    // M1 修复：所有 abnormal count 都加 range，与其他 KPI 同口径
    const [statusCount, timeoutCount] = await Promise.all([
      db.order.count({
        where: {
          status: { in: [...ABNORMAL_ORDER_STATUSES] },
          createdAt: { gte: range.from, lt: range.to },
        },
      }),
      db.order.count({
        where: {
          status: 'PENDING_CONFIRM',
          // pendingCutoff = now - 30min 已隐含 < range.to（range.to = now），无需重复 lt
          createdAt: { gte: range.from, lt: pendingCutoff },
        },
      }),
    ]);
    return statusCount + timeoutCount;
  }

  private async aggregateTrend(r: Range): Promise<TrendPointType[]> {
    /**
     * raw SQL 一次取回 trend（避免 24/30 次 groupBy 查询）
     *
     * B2 修复：AT TIME ZONE 'Asia/Dili'（市场口径）
     * M3 修复：SELECT 复用 bucketExpr 变量（避免重复三元判断）
     */
    const bucketExpr =
      r.bucketSecs === 3600
        ? `TO_CHAR(created_at AT TIME ZONE 'Asia/Dili', 'HH24:00')`
        : `TO_CHAR(created_at AT TIME ZONE 'Asia/Dili', 'YYYY-MM-DD')`;

    const rows = (await db.$queryRaw<
      Array<{ bucket: string; gmv: bigint; order_count: bigint }>
    >`
      SELECT ${Prisma.raw(bucketExpr)} AS bucket,
             COALESCE(SUM(payable_amount), 0) AS gmv,
             COUNT(*)::bigint AS order_count
      FROM orders
      WHERE created_at >= ${r.from}::timestamptz
        AND created_at < ${r.to}::timestamptz
        AND status IN ('CONFIRMED','PICKED','OUT_FOR_DELIVERY','DELIVERED_PAID','DELIVERED','COMPLETED')
      GROUP BY ${Prisma.raw(bucketExpr)}
      ORDER BY ${Prisma.raw(bucketExpr)}
    `).map((row) => ({
      bucket: row.bucket,
      gmv: Number(row.gmv),
      orderCount: Number(row.order_count),
    }));

    /** 按 bucket 索引补全空桶（前端绘图需要连续点） */
    const map = new Map(rows.map((r) => [r.bucket, r]));
    const result: TrendPointType[] = [];
    const cursor = new Date(r.from);
    for (let i = 0; i < r.bucketCount; i++) {
      const bucket = r.formatBucket(cursor);
      const point = map.get(bucket);
      result.push({
        bucket,
        gmv: point?.gmv ?? 0,
        orderCount: point?.orderCount ?? 0,
      });
      cursor.setTime(cursor.getTime() + r.bucketSecs * 1000);
    }
    return result;
  }

  private async aggregateWarehouseBreakdown(
    from: Date,
    to: Date,
  ): Promise<WarehouseBreakdownItemType[]> {
    const rows = await db.order.groupBy({
      by: ['warehouseId'],
      where: {
        createdAt: { gte: from, lt: to },
        status: { in: [...GMV_ORDER_STATUSES, ...ABNORMAL_ORDER_STATUSES] },
      },
      _sum: { payableAmount: true },
      _count: { _all: true },
    });

    if (rows.length === 0) return [];

    const warehouseIds = rows.map((r) => r.warehouseId);
    const warehouses = await db.warehouse.findMany({
      where: { id: { in: warehouseIds } },
      select: { id: true, name: true },
    });
    const whMap = new Map(
      warehouses.map((w) => [w.id, w.name as Record<string, string>]),
    );

    /** 异常订单按仓库分组（独立查询后内存合并） */
    const abnormalByWh = await db.order.groupBy({
      by: ['warehouseId'],
      where: {
        createdAt: { gte: from, lt: to },
        status: { in: [...ABNORMAL_ORDER_STATUSES] },
      },
      _count: { _all: true },
    });
    const abnormalMap = new Map(
      abnormalByWh.map((r) => [r.warehouseId, r._count._all]),
    );

    return rows
      .map((r) => {
        const name = whMap.get(r.warehouseId);
        if (!name) {
          logger.warn({
            msg: 'DASHBOARD_WAREHOUSE_MISSING',
            warehouseId: r.warehouseId,
          });
          return null;
        }
        return {
          warehouseId: r.warehouseId,
          warehouseName: name,
          gmv: r._sum.payableAmount ?? 0,
          orderCount: r._count._all,
          abnormalCount: abnormalMap.get(r.warehouseId) ?? 0,
        };
      })
      .filter((x): x is WarehouseBreakdownItemType => x !== null)
      .sort((a, b) => b.gmv - a.gmv);
  }
}
