/**
 * Statistics Service（数据分析报表聚合）
 *
 * 来源：数据分析报表模块 批B（2026-09-10）——商品销量排行（R9）
 *
 * 口径（单一事实源 = shared/statistics/metrics.ts + 数据口径.md）：
 *   - 数据源：OrderItem join Order（状态 ∈ GMV_ORDER_STATUSES，Order.createdAt ∈ range）
 *   - groupBy productId，sum(quantity/subtotal) + count(distinct orderId)
 *   - 排序：gmvAmount 降序 → 并列按 quantitySold 降序
 *   - 不读 Product.salesCount（长期累计，与区间聚合语义不同）
 *   - 金额单位分；商品名取 productName 快照按 lang 切片（fallback en，pickI18nField）
 *
 * 性能：raw SQL 一次聚合（吃批A 的 order_items_product_id_order_id_idx 复合索引），
 *       避免 Prisma groupBy + 内存 join Order 的两次往返。
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { buildRange } from '../../shared/statistics/range';
import { ABNORMAL_ORDER_STATUSES, GMV_ORDER_STATUSES } from '../../shared/statistics/metrics';
import { pickI18nField, type SupportedLanguage } from '@meimart/shared-utils';
import type {
  StatisticsRidersResponseItemType,
  StatisticsTopProductItemType,
} from '@meimart/api-contract';

/** 商品排行聚合入参（controller 已过 Zod 校验） */
export interface TopProductsParams {
  range?: 'today' | 'week' | 'month';
  from?: string;
  to?: string;
  limit: number;
  lang: SupportedLanguage;
}

/** 骑手绩效聚合入参（controller 已过 Zod 校验） */
export interface RidersParams {
  range?: 'today' | 'week' | 'month';
  from?: string;
  to?: string;
}

/** GMV 状态集合的 SQL IN 字面量（metrics 常量展开，单一事实源仍 metrics.ts） */
const GMV_STATUSES_SQL = Prisma.join(
  [...GMV_ORDER_STATUSES].map((s) => Prisma.sql`${s}`),
);

/** 骑手完成单状态集 SQL IN 字面量（R5 三值：task 自身状态不作为完成依据，join Order 判定） */
const COMPLETED_STATUSES_SQL = Prisma.join(
  (['DELIVERED_PAID', 'DELIVERED', 'COMPLETED'] as const).map((s) => Prisma.sql`${s}`),
);

/** 骑手异常单状态集 SQL IN 字面量（与 metrics.ts ABNORMAL_ORDER_STATUSES 同源） */
const ABNORMAL_STATUSES_SQL = Prisma.join(
  [...ABNORMAL_ORDER_STATUSES].map((s) => Prisma.sql`${s}`),
);

@Injectable()
export class StatisticsService {
  /**
   * 商品销量排行（R9）
   *
   * 返回 items 按 gmvAmount 降序、并列按 quantitySold 降序；金额单位分。
   * productName/productImage 取 OrderItem 下单快照（不 join products，快照即历史真相）。
   */
  async getTopProducts(params: TopProductsParams): Promise<{
    from: string;
    to: string;
    items: StatisticsTopProductItemType[];
  }> {
    // 时间范围校验/切日全部由批A 公共层负责（E-STATISTICS-001/002 在此抛出）
    const r =
      params.range !== undefined
        ? buildRange(params.range)
        : buildRange({ from: params.from as string, to: params.to as string });

    const rows = await db.$queryRaw<
      Array<{
        product_id: string;
        product_name: Prisma.JsonValue;
        product_image: string | null;
        order_count: bigint;
        quantity_sold: bigint;
        gmv_amount: bigint;
      }>
    >`
      SELECT oi.product_id,
             MIN(oi.product_name::text)  AS product_name,
             MIN(oi.product_image) AS product_image,
             COUNT(DISTINCT oi.order_id)::bigint AS order_count,
             SUM(oi.quantity)::bigint            AS quantity_sold,
             SUM(oi.subtotal)::bigint            AS gmv_amount
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ${r.from}::timestamptz
        AND o.created_at < ${r.to}::timestamptz
        AND o.status::text IN (${GMV_STATUSES_SQL})
      GROUP BY oi.product_id
      ORDER BY gmv_amount DESC, quantity_sold DESC
      LIMIT ${params.limit}
    `;

    const items = rows.map((row) => {
      // MIN(product_name::text) 返回的是 JSON 字符串（Prisma 不反序列化 text 列），需手动 parse
      const nameField =
        typeof row.product_name === 'string'
          ? (JSON.parse(row.product_name) as Record<string, string>)
          : (row.product_name as Record<string, string> | null);
      return {
        productId: row.product_id,
        productName: pickI18nField(nameField, params.lang),
        productImage: row.product_image,
        orderCount: Number(row.order_count),
        quantitySold: Number(row.quantity_sold),
        gmvAmount: Number(row.gmv_amount),
      };
    });

    return { from: r.from.toISOString(), to: r.to.toISOString(), items };
  }

  /**
   * 商品排行导出行（CSV 组装交给 statistics-csv.service，本方法只取数）
   * 复用 getTopProducts 聚合，导出上限放宽到 50（与页面 Top N 上限一致）
   */
  async getTopProductsForExport(params: Omit<TopProductsParams, 'limit'>) {
    return this.getTopProducts({ ...params, limit: 50 });
  }

  /**
   * 骑手绩效（批C，2026-09-10 / R5 修订口径）
   *
   * 口径（单一事实源 = shared/statistics/metrics.ts + 数据口径.md）：
   *   - 归属源：DeliveryTask（taskType='delivery'）.riderId —— 订单取消时
   *     order.service 清 Order.riderId，task 不清（只置 FAILED），按 Order 归属会漏计
   *   - 完成单：task 关联 Order 状态 ∈ (DELIVERED_PAID, DELIVERED, COMPLETED)——
   *     task 自身状态不作为完成依据（join Order 判定）
   *   - 异常单：task 关联 Order 状态 ∈ (CANCELLED, DELIVERED_UNPAID)
   *   - 超时未确认（PENDING_CONFIRM）：在配送前环节 riderId 必 null，天然不进本表
   *   - 收入：Settlement(subjectType='RIDER') periodDate ∈ range，各 status 均计入
   *     （直接吃既有 settlements [periodDate] 索引）；金额单位分
   *   - rating 取 RiderProfile.rating 快照；riderName 单值字符串非 Json
   *   - 排序：completedOrders 降序（并列按 income 降序，SQL ORDER BY 语义，服务层不重排）
   *
   * 性能：raw SQL 一次聚合（delivery_tasks [riderId, status] 索引 + settlements [periodDate] 索引）
   */
  async getRiders(params: RidersParams): Promise<{
    from: string;
    to: string;
    items: StatisticsRidersResponseItemType[];
  }> {
    const r =
      params.range !== undefined
        ? buildRange(params.range)
        : buildRange({ from: params.from as string, to: params.to as string });

    // 完成单 / 异常单：DeliveryTask(taskType=delivery) join Order，按 rider 聚合两个状态集
    const rows = await db.$queryRaw<
      Array<{
        rider_id: string;
        rider_name: string;
        rating: Prisma.Decimal | string | number;
        completed_orders: bigint;
        abnormal_count: bigint;
      }>
    >`
      SELECT dt.rider_id,
             rp.rider_name,
             rp.rating,
             COUNT(CASE WHEN o.status::text IN (${COMPLETED_STATUSES_SQL}) THEN 1 END)::bigint AS completed_orders,
             COUNT(CASE WHEN o.status::text IN (${ABNORMAL_STATUSES_SQL}) THEN 1 END)::bigint AS abnormal_count
      FROM delivery_tasks dt
      INNER JOIN orders o ON o.id = dt.order_id
      INNER JOIN rider_profiles rp ON rp.id = dt.rider_id
      WHERE dt.task_type = 'delivery'
        AND dt.rider_id IS NOT NULL
        AND o.created_at >= ${r.from}::timestamptz
        AND o.created_at < ${r.to}::timestamptz
      GROUP BY dt.rider_id, rp.rider_name, rp.rating
    `;

    // 收入：Settlement 按骑手聚合（periodDate ∈ range，各 status 均计入）
    // period_date 是 @db.Date（Dili 当地日的标签）。r.from/r.to 是 UTC 时间戳，
    // 不能直接 ::date（按服务器时区切日会平移一天——真库实测：窗口 Dili 08-12 吃到 08-11 的结算）。
    // 须 AT TIME ZONE 'Asia/Dili' 切回 Dili 墙钟再取 date：
    //   r.from = Dili from 日 0:00 → date = from 日；r.to = Dili to+1 日 0:00 → date = to+1 日（排他）
    const incomeRows = await db.$queryRaw<Array<{ subject_id: string; income: bigint }>>`
      SELECT s.subject_id,
             SUM(s.net_amount)::bigint AS income
      FROM settlements s
      WHERE s.subject_type = 'RIDER'
        AND s.period_date >= (${r.from} AT TIME ZONE 'Asia/Dili')::date
        AND s.period_date < (${r.to} AT TIME ZONE 'Asia/Dili')::date
      GROUP BY s.subject_id
    `;
    const incomeByRider = new Map(incomeRows.map((r2) => [r2.subject_id, Number(r2.income)]));

    const items = rows
      .map((row) => ({
        riderId: row.rider_id,
        riderName: row.rider_name,
        completedOrders: Number(row.completed_orders),
        income: incomeByRider.get(row.rider_id) ?? 0,
        rating: Number(row.rating),
        abnormalCount: Number(row.abnormal_count),
      }))
      .sort((a, b) =>
        b.completedOrders !== a.completedOrders
          ? b.completedOrders - a.completedOrders
          : b.income - a.income,
      );

    return { from: r.from.toISOString(), to: r.to.toISOString(), items };
  }

  /**
   * 骑手绩效导出行（CSV 组装交给 statistics-csv.service，本方法只取数）
   * 导出全量骑手（无 limit 截断）
   */
  async getRidersForExport(params: RidersParams) {
    return this.getRiders(params);
  }
}
