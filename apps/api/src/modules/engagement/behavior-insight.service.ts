/**
 * Behavior Insight Service — 批5 洞察消费（A7 搜索明细 / D5 漏斗 / A8 流失分，2026-10-18）
 *
 * 方案：方案v2 §三 批5 · 5（SearchLog 只消费不写；BehaviorEvent 只读）
 *
 * 口径红线（R-a 同源）：
 *   - 订单聚合 status IN ('COMPLETED','CANCELLED') 字面量、不过滤 deleted_at（同源）
 *   - 漏斗对账（P5-2）：曝光=SearchLog 行数 / 点击=SEARCH_CLICK 埋点 / 成交=含该商品
 *     的聚合基数订单——三层独立数据源（search_logs / behavior_events / order_items），
 *     数字各有来源可对账
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { getEngagementBehaviorConfig } from './behavior.config';

/** 聚合口径状态集（R-a 同源：与 profile/engagement/catalog 逐字一致） */
const INSIGHT_ORDER_STATUSES_SQL = "('COMPLETED', 'CANCELLED')";

/** D5 漏斗聚合行 */
export interface FunnelRow {
  word: string;
  /** 曝光：SearchLog 行数 */
  searches: number;
  /** 点击：SEARCH_CLICK 埋点数 */
  clicks: number;
  /** 成交：搜索词命中商品且含该商品聚合基数订单的 distinct (user, order) 数 */
  orders: number;
  /** 点击率（无曝光 null） */
  ctr: number | null;
  /** 点击→成交率（无点击 null） */
  conversion: number | null;
}

/** A8 流失信号构成 */
export interface ChurnSignal {
  /** 流失分 0-100（越高越可能流失） */
  score: number;
  /** 各信号明细 */
  parts: {
    /** 生命周期阶段名（SLEEPING/CHURNED 高权重） */
    stage: string;
    stageWeight: number;
    /** 近 N 天浏览活动分（有浏览=兴趣仍在，降流失分） */
    recentViews: number;
    viewWeight: number;
    /** 近 N 天搜索活动分 */
    recentSearches: number;
    searchWeight: number;
  };
}

@Injectable()
export class BehaviorInsightService {
  // 无跨模块依赖（db 直用）——无构造器注入需求

  /**
   * D5 搜索-成交漏斗（admin 端点数据源；SearchLog + SEARCH_CLICK + Order 三源对账）
   *
   * 曝光口径：近 N 天 SearchLog 行数（同词多行=多次搜索都算曝光）。
   * 点击口径：同窗口 SEARCH_CLICK 埋点数（P3-2 订正：匿名点击不计入——埋点不带词，
   * 点击归词依赖 user_id 关联 search_logs，匿名 SEARCH_CLICK join 不命中自然排除；
   * 以「用户近窗有搜索该词 + 30min 内点击」近似归词）。
   * 成交口径（P3-1 订正 2026-10-18）：搜索词按「订单内商品集包含判定」——订单的任一
   * order_item 商品其 name JSON 五语言任一 value 精确=词（先前版把精确匹配挂在
   * JOIN products 上，只有名字面=词的商品才计入，真库实测 米/powder 零命中，
   * 系统性低估）。现口径下订单属词当且仅当订单包含名字面=词的商品。
   */
  async getSearchFunnel(
    days: number,
    limit: number,
  ): Promise<{ windowDays: number; rows: FunnelRow[]; generatedAt: string }> {
    const daysN = Math.min(Math.max(days, 1), 90);
    const limitN = Math.min(Math.max(limit, 1), 100);

    // 1) 曝光：按词聚合 SearchLog
    const searchRows = await db.$queryRaw<Array<{ word: string; searches: bigint }>>`
      SELECT word, COUNT(*)::bigint AS searches
      FROM search_logs
      WHERE created_at >= now() - (${daysN} || ' days')::interval
      GROUP BY word
      ORDER BY searches DESC
      LIMIT ${limitN}
    `;
    if (searchRows.length === 0) {
      return { windowDays: daysN, rows: [], generatedAt: new Date().toISOString() };
    }
    const words = searchRows.map((r) => r.word);

    // 2) 点击：同窗口 SEARCH_CLICK 总量（埋点不带词——点击归词是近似：用户搜过该词即计入）
    const clickRows = await db.$queryRaw<Array<{ word: string; clicks: bigint }>>`
      SELECT s.word, COUNT(b.id)::bigint AS clicks
      FROM search_logs s
      LEFT JOIN behavior_events b
        ON b.type = 'SEARCH_CLICK'
        AND b.user_id = s.user_id
        AND b.created_at >= s.created_at
        AND b.created_at <= s.created_at + interval '30 minutes'
      WHERE s.word IN (${Prisma.join(words)})
        AND s.created_at >= now() - (${daysN} || ' days')::interval
      GROUP BY s.word
    `;
    // 3) 成交（P3-1 订正：订单内商品集包含判定）——订单属词当且仅当订单的任一
    //    order_item 商品 name JSON 5 语言任一 value 精确=词；含该商品聚合基数订单
    //    的 distinct (user_id, order_id)。先按词圈定命中商品集，再 EXISTS 进订单。
    const orderRows = await db.$queryRaw<Array<{ word: string; orders: bigint }>>`
      SELECT w.word, COUNT(DISTINCT (o.user_id, o.id))::bigint AS orders
      FROM (SELECT unnest(${words}::text[]) AS word) w
      JOIN orders o
        ON o.status IN ${Prisma.raw(INSIGHT_ORDER_STATUSES_SQL)}
        AND o.created_at >= now() - (${daysN} || ' days')::interval
      WHERE EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id
          AND (p.name->>'en' = w.word
            OR p.name->>'zh' = w.word
            OR p.name->>'id' = w.word
            OR p.name->>'pt' = w.word
            OR p.name->>'tet' = w.word)
      )
      GROUP BY w.word
    `;
    const clickMap = new Map(clickRows.map((r) => [r.word, Number(r.clicks)]));
    const orderMap = new Map(orderRows.map((r) => [r.word, Number(r.orders)]));

    const rows: FunnelRow[] = searchRows.map((r) => {
      const searches = Number(r.searches);
      const clicks = clickMap.get(r.word) ?? 0;
      const orders = orderMap.get(r.word) ?? 0;
      return {
        word: r.word,
        searches,
        clicks,
        orders,
        ctr: searches > 0 ? clicks / searches : null,
        conversion: clicks > 0 ? orders / clicks : null,
      };
    });
    return { windowDays: daysN, rows, generatedAt: new Date().toISOString() };
  }

  /**
   * A7 per-user 搜索明细（admin 单客 360 时间线并入）。
   * 只读消费 SearchLog（写入链在 search.service，本服务不写——批5 订正 #1）。
   */
  async getUserSearchHistory(userId: string, limit: number): Promise<{
    items: Array<{ id: string; word: string; lang: string; resultCount: number; createdAt: string }>;
  }> {
    const limitN = Math.min(Math.max(limit, 1), 100);
    const rows = await db.searchLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limitN,
      select: { id: true, word: true, lang: true, resultCount: true, createdAt: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id.toString(),
        word: r.word,
        lang: r.lang,
        resultCount: r.resultCount,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * A8 流失分（批1 画像服务扩展的数据源；信号可配 G5）。
   *
   * 口径：0-100 分，构成：
   *   - 生命周期权重（SLEEPING=40 / CHURNED=60 / 其他=0）
   *   - 近 churnViewDecayDays 天浏览活动：每笔 VIEW 减 churnViewWeight 分（上限 20）
   *   - 近 7 天搜索活动：每笔 SearchLog 减 1 分（上限 10）
   * 分数 clamp 到 [0, 100]。
   */
  async getChurnSignal(userId: string, fCount: number, rDays: number | null): Promise<ChurnSignal> {
    const cfg = await getEngagementBehaviorConfig();
    const sinceView = new Date(Date.now() - cfg.churnViewDecayDays * 86_400_000);
    const sinceSearch = new Date(Date.now() - 7 * 86_400_000);

    const [viewRows, searchRows] = await Promise.all([
      db.behaviorEvent.count({
        where: { userId, type: 'VIEW', createdAt: { gte: sinceView } },
      }),
      db.searchLog.count({ where: { userId, createdAt: { gte: sinceSearch } } }),
    ]);

    // 生命周期权重（复用批1 lifecycle 阶段机口径）
    let stageWeight = 0;
    let stage = 'NEW';
    if (fCount === 0) {
      stage = 'NEW';
      stageWeight = 30;
    } else if (rDays === null) {
      stage = 'NEW';
    } else if (rDays > 90) {
      stage = 'CHURNED';
      stageWeight = 60;
    } else if (rDays > 30) {
      stage = 'SLEEPING';
      stageWeight = 40;
    } else {
      stage = 'ACTIVE';
    }
    const viewDeduction = Math.min(viewRows * cfg.churnViewWeight, 20);
    const searchDeduction = Math.min(searchRows, 10);
    const score = Math.max(0, Math.min(100, Math.round(stageWeight - viewDeduction - searchDeduction)));

    return {
      score,
      parts: {
        stage,
        stageWeight,
        recentViews: viewRows,
        viewWeight: viewDeduction,
        recentSearches: searchRows,
        searchWeight: searchDeduction,
      },
    };
  }
}
