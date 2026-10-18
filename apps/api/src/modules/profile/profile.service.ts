/**
 * Profile Service — 共享用户画像聚合服务（客户画像批1 2026-10-18）
 *
 * 方案：方案v2-客户画像与个性化运营-20261017 §三 批1（A1 A2 A3 A4 A6）
 *
 * ⚠️ 口径同源红线（R-a，批 2~6 共同地基）：
 *   聚合 SQL 引用 catalog.service.ts aggregateCategoryPreference 范式（个性化推荐批1 固化）：
 *     - 状态口径：o.status IN ('COMPLETED','CANCELLED')
 *     - 软删口径：不过滤 deletedAt（P27 继承拍板：软删订单计入历史画像）
 *     - 排序口径：freq DESC + last_at DESC
 *     - 参数化：tagged template（防注入），不拼字符串
 *   不造第二套口径；批 2~6 一律消费本服务，不得各自聚合。
 *
 * 七维聚合：
 *   1. 订单史时间线（近 N 单）
 *   2. RFM 值（R=距最近购买天数 / F=订单数 / M=累计实付）
 *   3. 生命周期阶段（lifecycle.ts 阶段机，阈值可配）
 *   4. 品类偏好分布（top 5 类目按频次）
 *   5. 客单价带（min/avg/max 单笔实付）
 *   6. 折扣敏感度（用券/折扣订单占比）
 *   7. 高峰下单时段 + 常用地址（按配送快照聚合）
 */
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { MARKET_TIMEZONE } from '../../shared/datetime';
import { pickI18nField, type SupportedLanguage } from '@meimart/shared-utils';
import { getProfileThresholds } from './profile.config';
import { getLifecycleStage, type LifecycleStage } from './lifecycle';
import { BEHAVIOR_INSIGHT_SERVICE_TOKEN } from './profile.tokens';
import type { BehaviorInsightService } from '../engagement/behavior-insight.service';

/** 聚合口径状态集（R-a 同源：与 catalog.service.ts:292-303 逐字一致） */
const PROFILE_ORDER_STATUSES_SQL = "('COMPLETED', 'CANCELLED')";

/** 订单史时间线上限（背调页一屏可读） */
const TIMELINE_LIMIT = 20;

/** 品类偏好 top N */
const CATEGORY_TOP_N = 5;

/** 常用地址 top N（按订单配送快照去重频次） */
const ADDRESS_TOP_N = 5;

/** 类目偏好分布项 */
export interface CategoryPreferenceItem {
  categoryId: string | null;
  /** 多语言类目名（pickI18nField 切片，fallback en） */
  name: string;
  /** 该类目订单条目频次 */
  freq: number;
  /** 占该用户总条目频次比例（0-1） */
  share: number;
}

/** 高峰时段分布项（0-23 小时） */
export interface HourBucketItem {
  hour: number;
  freq: number;
}

/** 常用地址项（按下单配送快照聚合，非 Address 表——快照才是"真收过货"的地址） */
export interface FrequentAddressItem {
  /** 快照 detail（脱敏交给前端，后端原样返回） */
  detail: string;
  region: string;
  freq: number;
}

/** RFM 值 */
export interface ProfileRfm {
  /** 距最近一次购买天数（Dili 当地日历日差）；无购买 null */
  rDays: number | null;
  /** 聚合基数订单数 */
  fCount: number;
  /** 累计实付金额（分） */
  mTotal: number;
  /** 最近一次购买时间（ISO）；无购买 null */
  lastPurchaseAt: string | null;
  /** 首次购买时间（ISO）；无购买 null */
  firstPurchaseAt: string | null;
}

@Injectable()
export class ProfileService {
  constructor(
    // 批5 A7/A8 并入：行为洞察服务（搜索明细 + 流失分）；可选注入（单测直接 new 可传 null）
    @Inject(BEHAVIOR_INSIGHT_SERVICE_TOKEN)
    private readonly behaviorInsight: BehaviorInsightService | null,
  ) {}

  /**
   * 单客 360 聚合（admin 背调页数据源；批 2~6 共享入口）
   *
   * 所有聚合一次并发发出，单用户 O(1) 查询量。
   *
   * @param userId 目标用户 id
   * @param lang 类目名切片语言（Accept-Language 解析结果，fallback en）
   */
  async getCustomerProfile360(
    userId: string,
    lang: SupportedLanguage = 'en',
  ): Promise<{
    rfm: ProfileRfm;
    lifecycle: { stage: LifecycleStage };
    categoryPreferences: CategoryPreferenceItem[];
    priceBand: { min: number; avg: number | null; max: number };
    discountSensitivity: { discountOrderCount: number; totalOrderCount: number; ratio: number | null };
    peakHours: HourBucketItem[];
    frequentAddresses: FrequentAddressItem[];
    timeline: Array<{
      id: string;
      orderNo: string;
      status: string;
      payableAmount: number;
      discountAmount: number;
      createdAt: string;
    }>;
    /** 批5 A7 并入：近 20 条搜索明细（洞察降级 null） */
    searchHistory: Array<{ id: string; word: string; lang: string; resultCount: number; createdAt: string }> | null;
    /** 批5 A8 并入：流失分 0-100 + 信号构成（洞察降级 null） */
    churn: {
      score: number;
      parts: {
        stage: string;
        stageWeight: number;
        recentViews: number;
        viewWeight: number;
        recentSearches: number;
        searchWeight: number;
      };
    } | null;
  }> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException({ code: 'E-PROFILE-001', message: '用户不存在' });
    }

    const [rfmResult, categoryRows, priceRows, hourRows, addressRows, timelineRows] =
      await Promise.all([
        this.aggregateRfm(userId),
        this.aggregateCategoryPreference(userId, lang),
        this.aggregatePriceBand(userId),
        this.aggregatePeakHours(userId),
        this.aggregateFrequentAddresses(userId),
        this.getTimeline(userId),
      ]);
    const { rfm, discountMeta } = rfmResult;

    const thresholds = await getProfileThresholds();
    const stage = getLifecycleStage(rfm.fCount, rfm.rDays, thresholds);

    // 批5 A7/A8 并入（P5-4）：搜索明细 + 流失分（洞察服务缺失时降级 null，不炸画像）
    let searchHistory: Awaited<ReturnType<BehaviorInsightService['getUserSearchHistory']>> | null = null;
    let churn: Awaited<ReturnType<BehaviorInsightService['getChurnSignal']>> | null = null;
    if (this.behaviorInsight) {
      try {
        [searchHistory, churn] = await Promise.all([
          this.behaviorInsight.getUserSearchHistory(userId, 20),
          this.behaviorInsight.getChurnSignal(userId, rfm.fCount, rfm.rDays),
        ]);
      } catch (err) {
        // 洞察失败降级：360 页其余维度照常返回
        searchHistory = null;
        churn = null;
        logger.warn({
          msg: 'PROFILE_INSIGHT_DEGRADE',
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 白名单输出：rfm 只透传契约五字段（P2-1 修复——_discountMeta 不得外带）
    return {
      rfm,
      lifecycle: { stage },
      categoryPreferences: categoryRows,
      priceBand: priceRows,
      discountSensitivity: this.aggregateDiscountSensitivity(rfm.fCount, discountMeta),
      peakHours: hourRows,
      frequentAddresses: addressRows,
      timeline: timelineRows,
      // 批5 A7/A8 并入（洞察降级时 null——admin-web 渲染「暂无」即可）
      searchHistory: searchHistory?.items ?? null,
      churn,
    };
  }

  // ===== 各维聚合（全部引用 catalog SQL 范式）=====

  /**
   * RFM：一扫聚合（同一 WHERE 口径出 R/F/M/首末购时间，避免多查询口径漂移）
   * 返回拆两段：rfm（契约五字段）+ discountMeta（服务内部，不出契约——P2-1 修复）
   */
  private async aggregateRfm(
    userId: string,
  ): Promise<{ rfm: ProfileRfm; discountMeta: DiscountMeta }> {
    const rows = await db.$queryRaw<
      Array<{
        f_count: bigint;
        m_total: bigint | null;
        first_at: Date | null;
        last_at: Date | null;
        discount_order_count: bigint;
        discount_total: bigint | null;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS f_count,
        COALESCE(SUM(o.payable_amount), 0)::bigint AS m_total,
        MIN(o.created_at) AS first_at,
        MAX(o.created_at) AS last_at,
        COUNT(*) FILTER (WHERE o.discount_amount > 0)::bigint AS discount_order_count,
        COALESCE(SUM(o.discount_amount), 0)::bigint AS discount_total
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(PROFILE_ORDER_STATUSES_SQL)}
    `;
    const row = rows[0];
    const fCount = Number(row?.f_count ?? 0);
    const mTotal = Number(row?.m_total ?? 0);
    const lastAt = row?.last_at ?? null;
    const firstAt = row?.first_at ?? null;
    return {
      rfm: {
        fCount,
        mTotal,
        rDays: lastAt ? daysSinceInTz(lastAt) : null,
        lastPurchaseAt: lastAt ? lastAt.toISOString() : null,
        firstPurchaseAt: firstAt ? firstAt.toISOString() : null,
      },
      discountMeta: {
        discountOrderCount: Number(row?.discount_order_count ?? 0),
        discountTotal: Number(row?.discount_total ?? 0),
      },
    };
  }

  /**
   * 品类偏好分布（top N）——SQL 结构引用 catalog.service.ts aggregateCategoryPreference
   * （同 join/同 WHERE/同排序；仅 GROUP BY 粒度从 product 放宽到 category + LIMIT 放宽到全类目）
   */
  private async aggregateCategoryPreference(
    userId: string,
    lang: SupportedLanguage,
  ): Promise<CategoryPreferenceItem[]> {
    const rows = (await db.$queryRaw<
      { category_id: string | null; name: unknown; freq: bigint }[]
    >`
      SELECT p.category_id, c.name AS name, COUNT(*)::bigint AS freq
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(PROFILE_ORDER_STATUSES_SQL)}
      GROUP BY p.category_id, c.name
      ORDER BY freq DESC
      LIMIT ${CATEGORY_TOP_N}
    `) as { category_id: string | null; name: unknown; freq: bigint }[];

    const totalFreq = rows.reduce((s, r) => s + Number(r.freq), 0);
    return rows.map((r) => ({
      categoryId: r.category_id,
      name: pickI18nField(r.name as Record<string, string> | null, lang),
      freq: Number(r.freq),
      share: totalFreq > 0 ? Number(r.freq) / totalFreq : 0,
    }));
  }

  /** 客单价带（单笔实付 min/avg/max） */
  private async aggregatePriceBand(userId: string): Promise<{
    min: number;
    avg: number | null;
    max: number;
  }> {
    const rows = await db.$queryRaw<
      Array<{ min_amt: bigint | null; avg_amt: Prisma.Decimal | null; max_amt: bigint | null; cnt: bigint }>
    >`
      SELECT
        MIN(o.payable_amount)::bigint AS min_amt,
        AVG(o.payable_amount) AS avg_amt,
        MAX(o.payable_amount)::bigint AS max_amt,
        COUNT(*)::bigint AS cnt
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(PROFILE_ORDER_STATUSES_SQL)}
    `;
    const row = rows[0];
    const min = Number(row?.min_amt ?? 0);
    const max = Number(row?.max_amt ?? 0);
    const avg = row?.avg_amt != null ? Number(row.avg_amt) : null;
    return { min, avg, max };
  }

  /** 折扣敏感度（用券/折扣订单占比）——基于 aggregateRfm 的 FILTER 聚合（同一扫描，口径同源） */
  private aggregateDiscountSensitivity(
    totalOrderCount: number,
    meta: DiscountMeta,
  ): { discountOrderCount: number; totalOrderCount: number; ratio: number | null } {
    const discountOrderCount = meta.discountOrderCount;
    return {
      discountOrderCount,
      totalOrderCount,
      ratio: totalOrderCount > 0 ? discountOrderCount / totalOrderCount : null,
    };
  }

  /** 高峰下单时段（Dili 当地小时 0-23 分布） */
  private async aggregatePeakHours(userId: string): Promise<HourBucketItem[]> {
    const rows = await db.$queryRaw<
      Array<{ hour: number; freq: bigint }>
    >`
      SELECT EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${MARKET_TIMEZONE}))::int AS hour,
             COUNT(*)::bigint AS freq
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(PROFILE_ORDER_STATUSES_SQL)}
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((r) => ({ hour: Number(r.hour), freq: Number(r.freq) }));
  }

  /** 常用地址（下单配送快照聚合 top N——快照代表真实收货地） */
  private async aggregateFrequentAddresses(userId: string): Promise<FrequentAddressItem[]> {
    const rows = await db.$queryRaw<
      Array<{ detail: string; region: unknown; freq: bigint }>
    >`
      SELECT o.delivery_address->>'detail' AS detail,
             o.delivery_address->'region' AS region,
             COUNT(*)::bigint AS freq
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(PROFILE_ORDER_STATUSES_SQL)}
        AND o.delivery_address ? 'detail'
      GROUP BY 1, 2
      ORDER BY freq DESC
      LIMIT ${ADDRESS_TOP_N}
    `;
    return rows.map((r) => ({
      detail: r.detail,
      region: pickI18nField(r.region as Record<string, string> | null, 'en'),
      freq: Number(r.freq),
    }));
  }

  /** 订单史时间线（近 N 单，含 CANCELLED——背调需要看见取消行为） */
  private async getTimeline(userId: string) {
    const orders = await db.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: TIMELINE_LIMIT,
      select: {
        id: true,
        orderNo: true,
        status: true,
        payableAmount: true,
        discountAmount: true,
        createdAt: true,
      },
    });
    return orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      payableAmount: o.payableAmount,
      discountAmount: o.discountAmount,
      createdAt: o.createdAt.toISOString(),
    }));
  }
}

/** 折扣聚合中间量（服务内部传递，不出契约） */
interface DiscountMeta {
  discountOrderCount: number;
  discountTotal: number;
  orderCount?: number;
}

/**
 * 距给定时间的天数（Dili 当地日历日差，非 24h 时差）
 * 例：昨天 23:59 → 今天 00:01 也是 1 天（日历口径，与阈值语义一致）
 */
function daysSinceInTz(from: Date, now: Date = new Date()): number {
  const tz = MARKET_TIMEZONE;
  const dayOf = (d: Date): number => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = Number(parts.find((p) => p.type === 'year')!.value);
    const m = Number(parts.find((p) => p.type === 'month')!.value);
    const day = Number(parts.find((p) => p.type === 'day')!.value);
    // 用 UTC 毫秒差近似日历差（Dili 固定 UTC+9 无 DST，安全）
    return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
  };
  return dayOf(now) - dayOf(from);
}
