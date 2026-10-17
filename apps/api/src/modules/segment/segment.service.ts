/**
 * Segment Service — RFM 分层运营（客户画像批2 2026-10-18）
 *
 * 方案：方案v2 §三 批2（D2 D3 D4 D7 + C5）+ 订正 #7 + R-f
 *
 * 口径同源（R-a / R-f）：
 *   - 分层判定复用 profile 模块：getLifecycleStage + getProfileThresholds（G5 同源），
 *     不造第二套分层口径——看板人数/单客页 stage 必须对账一致（P2-1）。
 *   - 聚合基数 SQL 引用 profile.service.ts PROFILE_ORDER_STATUSES_SQL 范式
 *     （COMPLETED+CANCELLED、不过滤 deletedAt、tagged template 参数化）。
 *
 * 端点（AdminSegmentController，前缀 /api/v1/admin/marketing/segments）：
 *   GET  /dashboard        各层人数 / GMV / 占比（D2）
 *   GET  /co-purchase      买 X 还买 Y 共现（D3，OrderItem 共现统计，非算法）
 *   GET  /repurchase       各层回购率（D3）
 *   GET  /coupon-attribution/:promotionId  券归因按层拆解（D4）
 *   GET  /export           按层导出名单 CSV（D7，查看即审计）
 *   POST /coupons/grant    批量发券（D7，SUPER_ADMIN + 频控 + 单批上限 + 幂等）
 *   GET/POST/PATCH/DELETE /coupon-rules   分层定向券规则 C5（规则表，G5 可配）
 */
import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { pickI18nField, type SupportedLanguage } from '@meimart/shared-utils';
import {
  parseSegmentBatchGrantLimit,
} from './segment.config';
import { getProfileThresholds } from '../profile/profile.config';
import { getLifecycleStage, type LifecycleStage } from '../profile/lifecycle';

/** 聚合口径状态集（R-a 同源：与 profile.service.ts 逐字一致） */
const SEGMENT_ORDER_STATUSES_SQL = "('COMPLETED', 'CANCELLED')";

/** 共现分析：目标商品的关联商品 top N（MVP 一屏可读） */
const CO_PURCHASE_TOP_N = 10;

/** 单批发券明细上限的硬顶（G5 可配值再大也不超过；防误配置刷爆） */
const BATCH_GRANT_HARD_CAP = 5000;

/** 层→人数/GMV 行 */
export interface SegmentBucketRow {
  stage: LifecycleStage;
  userCount: number;
  /** 该层累计实付（分） */
  gmvTotal: number;
  /** GMV 占比（0-1，全层合计=1） */
  gmvShare: number;
}

/** 共现项 */
export interface CoPurchaseItem {
  productId: string;
  name: string;
  /** 同时购买目标商品的订单数（共现订单数） */
  coOrderCount: number;
  /** 占目标商品订单数比例（0-1） */
  share: number;
}

/** 券归因行 */
export interface CouponAttributionRow {
  stage: LifecycleStage;
  /** 发放后仍 UNUSED（口径写进端点描述，R2 精神：领取≠核销） */
  claimed: number;
  /** 已核销（USED） */
  redeemed: number;
  /** 核销率（redeemed / claimed，0-1；claimed=0 时 null） */
  redeemRate: number | null;
  /** 领券用户发券后 30 天内的实付订单数（复购增量口径，见 getCustomerCouponAttribution 注释） */
  repurchaseOrders: number;
  userCount: number;
}

@Injectable()
export class SegmentService {
  /**
   * D2 看板：各层人数 / GMV / 占比
   *
   * 实现：一次扫描全体用户（COMPLETED+CANCELLED 口径聚合 F/M/R 裸值），
   * 内存中按 G5 阈值跑 getLifecycleStage 归层。用户量 MVP 规模（<1e4）单扫描够用；
   * 阈值变化只需重算内存分组，不需重扫 DB。
   */
  async getSegmentDashboard(): Promise<{
    totalUsers: number;
    purchasedUsers: number;
    buckets: SegmentBucketRow[];
    generatedAt: string;
  }> {
    const thresholds = await getProfileThresholds();
    // 单扫描：每用户 F / M / R 裸值（与 profile.service.aggregateRfm 同口径：同 status 集、不过滤 deletedAt）
    const rows = await db.$queryRaw<
      Array<{ user_id: string; f_count: bigint; m_total: bigint | null; last_at: Date | null }>
    >`
      SELECT o.user_id,
             COUNT(*)::bigint AS f_count,
             COALESCE(SUM(o.payable_amount), 0)::bigint AS m_total,
             MAX(o.created_at) AS last_at
      FROM orders o
      WHERE o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
      GROUP BY o.user_id
    `;

    const now = new Date();
    // 归层（与单客同函数 getLifecycleStage → P2-1 对账同源）
    const stageOf = (f: number, lastAt: Date | null): LifecycleStage =>
      getLifecycleStage(f, lastAt ? daysSinceInTz(lastAt, now) : null, thresholds);

    const map = new Map<LifecycleStage, { userCount: number; gmvTotal: number }>();
    for (const stage of ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'] as const) {
      map.set(stage, { userCount: 0, gmvTotal: 0 });
    }
    let purchasedUsers = 0;
    let totalGmv = 0;
    for (const r of rows) {
      const f = Number(r.f_count);
      const m = Number(r.m_total ?? 0);
      const stage = stageOf(f, r.last_at);
      const bucket = map.get(stage)!;
      bucket.userCount += 1;
      bucket.gmvTotal += m;
      if (f > 0) purchasedUsers += 1;
      totalGmv += m;
    }
    // NEW 用户（无聚合基数订单）不出现在 GROUP BY 结果里，补齐：全体用户 - 有购买用户
    const totalUsers = await db.user.count();
    map.get('NEW')!.userCount = Math.max(0, totalUsers - purchasedUsers);

    const buckets = [...map.entries()].map(([stage, v]) => ({
      stage,
      userCount: v.userCount,
      gmvTotal: v.gmvTotal,
      gmvShare: totalGmv > 0 ? v.gmvTotal / totalGmv : 0,
    }));

    return { totalUsers, purchasedUsers, buckets, generatedAt: now.toISOString() };
  }

  /**
   * D3 共现：买 X（productId）的订单里还买了什么（OrderItem 共现统计，SQL 聚合非算法）
   *
   * 口径：COMPLETED+CANCELLED 订单的 order_items 两两共现；share = 共现订单数 / 目标商品订单数。
   * 边界：单买家商品对（所有共现都来自同一用户）不去重——报表反映全量事实，单买家
   * 影响用 repurchase 端点各层对比来解释。
   */
  async getCoPurchase(productId: string, lang: SupportedLanguage = 'en') {
    // 目标商品名（i18n 切片）
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { name: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'E-SEGMENT-005', message: 'Product not found' });
    }

    // 目标商品出现在多少订单（分母）
    const baseRows = await db.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(DISTINCT oi.order_id)::bigint AS cnt
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ${productId}
        AND o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
    `;
    const baseCount = Number(baseRows[0]?.cnt ?? 0);

    // 共现：同订单里的其他商品，按共现订单数排（freq DESC + last_at DESC 口径对齐）
    const rows = (await db.$queryRaw<
      Array<{ product_id: string; name: unknown; cnt: bigint }>
    >`
      SELECT oi2.product_id,
             p.name AS name,
             COUNT(DISTINCT oi2.order_id)::bigint AS cnt
      FROM order_items oi1
      JOIN orders o ON o.id = oi1.order_id
      JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id <> oi1.product_id
      JOIN products p ON p.id = oi2.product_id
      WHERE oi1.product_id = ${productId}
        AND o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
      GROUP BY oi2.product_id, p.name
      ORDER BY cnt DESC, oi2.product_id ASC
      LIMIT ${CO_PURCHASE_TOP_N}
    `) as Array<{ product_id: string; name: unknown; cnt: bigint }>;

    return {
      product: { id: productId, name: pickI18nField(product.name as Record<string, string> | null, lang) },
      baseOrderCount: baseCount,
      items: rows.map((r) => ({
        productId: r.product_id,
        name: pickI18nField(r.name as Record<string, string> | null, lang),
        coOrderCount: Number(r.cnt),
        share: baseCount > 0 ? Number(r.cnt) / baseCount : 0,
      })),
    };
  }

  /**
   * D3 分层回购率：各层中"有多笔订单（F≥2）"的用户占比
   *
   * 口径：F 用聚合基数（COMPLETED+CANCELLED），层用 G5 阈值（同 getSegmentDashboard 扫描）。
   * 回购率 = 该层 F≥2 人数 / 该层总人数；层人数为 0 时 null。
   */
  async getSegmentRepurchase() {
    const thresholds = await getProfileThresholds();
    const rows = await db.$queryRaw<
      Array<{ user_id: string; f_count: bigint; last_at: Date | null }>
    >`
      SELECT o.user_id,
             COUNT(*)::bigint AS f_count,
             MAX(o.created_at) AS last_at
      FROM orders o
      WHERE o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
      GROUP BY o.user_id
    `;
    const now = new Date();
    const stageOf = (f: number, lastAt: Date | null): LifecycleStage =>
      getLifecycleStage(f, lastAt ? daysSinceInTz(lastAt, now) : null, thresholds);

    const total = new Map<LifecycleStage, number>();
    const repeat = new Map<LifecycleStage, number>();
    for (const s of ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'] as const) {
      total.set(s, 0);
      repeat.set(s, 0);
    }
    for (const r of rows) {
      const f = Number(r.f_count);
      const stage = stageOf(f, r.last_at);
      total.set(stage, (total.get(stage) ?? 0) + 1);
      if (f >= 2) repeat.set(stage, (repeat.get(stage) ?? 0) + 1);
    }
    const totalUsers = await db.user.count();
    const purchasedTotal = rows.length;
    total.set('NEW', Math.max(0, totalUsers - purchasedTotal));

    const stages: LifecycleStage[] = ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'];
    return {
      stages: stages.map((s) => ({
        stage: s,
        userCount: total.get(s) ?? 0,
        repurchaseUserCount: repeat.get(s) ?? 0,
        repurchaseRate: (total.get(s) ?? 0) > 0 ? (repeat.get(s) ?? 0) / (total.get(s) ?? 0) : null,
      })),
      generatedAt: now.toISOString(),
    };
  }

  /**
   * D4 券归因：按 RFM 层拆解某券的领取/核销/复购增量
   *
   * 口径（端点描述同步，R2 精神）：
   *   - claimed  = 该层用户中持有该券（UserCoupon 任意状态）的人数
   *   - redeemed = 其中 status=USED 的人数
   *   - redeemRate = redeemed / claimed（领取≠核销：UNUSED 是领了没用）
   *   - repurchaseOrders = 领券用户在 receivedAt 之后 30 天内的实付订单数
     *     （COMPLETED+CANCELLED 口径，按层合计；含领券当单——领券后下单即计）
   *   - userCount = 该层全体人数（算渗透率用）
   */
  async getCouponAttribution(promotionId: string) {
    const promo = await db.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
    if (!promo) {
      throw new NotFoundException({ code: 'E-COUPON-004', message: 'Coupon template not available' });
    }

    const thresholds = await getProfileThresholds();
    // 领券用户的 F/M/R + 券状态 + receivedAt（一次扫描）
    const rows = await db.$queryRaw<
      Array<{
        user_id: string;
        f_count: bigint;
        last_at: Date | null;
        uc_status: string;
        received_at: Date;
      }>
    >`
      SELECT u.id AS user_id,
             agg.f_count,
             agg.last_at,
             uc.status AS uc_status,
             uc.received_at
      FROM user_coupons uc
      JOIN users u ON u.id = uc.user_id
      LEFT JOIN (
        SELECT o.user_id,
               COUNT(*)::bigint AS f_count,
               MAX(o.created_at) AS last_at
        FROM orders o
        WHERE o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
        GROUP BY o.user_id
      ) agg ON agg.user_id = u.id
      WHERE uc.promotion_id = ${promotionId}
    `;

    const now = new Date();
    // 每用户归层 + 券状态聚合（同用户同券理论 1 行，@@unique 保证）
    type Acc = { claimed: number; redeemed: number; repurchaseOrders: number; userCount: number };
    const acc = new Map<LifecycleStage, Acc>();
    for (const s of ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'] as const) {
      acc.set(s, { claimed: 0, redeemed: 0, repurchaseOrders: 0, userCount: 0 });
    }
    // 复购窗口：receivedAt + 30 天
    const REPURCHASE_WINDOW_DAYS = 30;
    for (const r of rows) {
      const f = Number(r.f_count ?? 0);
      const stage = getLifecycleStage(
        f,
        r.last_at ? daysSinceInTz(r.last_at, now) : null,
        thresholds,
      );
      const a = acc.get(stage)!;
      a.claimed += 1;
      if (r.uc_status === 'USED') a.redeemed += 1;
      // 复购增量：receivedAt 之后 30 天内该用户的订单数（含 CANCELLED，口径同源）
      const windowEnd = new Date(r.received_at.getTime() + REPURCHASE_WINDOW_DAYS * 86_400_000);
      const cnt = await this.countOrdersAfter(r.user_id, r.received_at, windowEnd);
      a.repurchaseOrders += cnt;
      a.userCount += 1;
    }
    // 各层全体人数（渗透率分母）：复用看板扫描
    const dashboardRows = await db.$queryRaw<
      Array<{ user_id: string; f_count: bigint; last_at: Date | null }>
    >`
      SELECT o.user_id, COUNT(*)::bigint AS f_count, MAX(o.created_at) AS last_at
      FROM orders o
      WHERE o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
      GROUP BY o.user_id
    `;
    const stageTotal = new Map<LifecycleStage, number>();
    for (const s of ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'] as const) {
      stageTotal.set(s, 0);
    }
    for (const r of dashboardRows) {
      const stage = getLifecycleStage(
        Number(r.f_count),
        r.last_at ? daysSinceInTz(r.last_at, now) : null,
        thresholds,
      );
      stageTotal.set(stage, (stageTotal.get(stage) ?? 0) + 1);
    }
    const totalUsers = await db.user.count();
    stageTotal.set('NEW', Math.max(0, totalUsers - dashboardRows.length));

    const stages: LifecycleStage[] = ['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED'];
    return {
      promotionId,
      rows: stages.map((s) => {
        const a = acc.get(s)!;
        return {
          stage: s,
          claimed: a.claimed,
          redeemed: a.redeemed,
          redeemRate: a.claimed > 0 ? a.redeemed / a.claimed : null,
          repurchaseOrders: a.repurchaseOrders,
          userCount: stageTotal.get(s) ?? 0,
        };
      }),
    };
  }

  /** D7 导出：按层导出名单 CSV（列名 i18n，转义对齐 inventory escape 范式） */
  async exportSegmentCsv(stage: LifecycleStage, lang: SupportedLanguage): Promise<string> {
    const rows = await this.listUsersInStage(stage);
    // 列名：shared-locales common.json admin.marketing 平铺键（五语 parity；未知语兜底 en）
    const { messages, DEFAULT_LOCALE } = (await import('@meimart/shared-locales')) as typeof import('@meimart/shared-locales');
    const locale = (lang as string) in messages ? (lang as keyof typeof messages) : DEFAULT_LOCALE;
    const bundle = messages[locale] ?? messages[DEFAULT_LOCALE];
    const adminNs = (bundle.common as Record<string, unknown>)['admin'] as Record<string, unknown>;
    const block = (adminNs['marketing'] ?? {}) as Record<string, string>;
    const col = (key: string): string => {
      const v = block[`export${key}`];
      if (typeof v !== 'string' || v === '') throw new Error(`missing i18n key admin.marketing.export${key}`);
      return v;
    };
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = [
      col('UserId'),
      col('Phone'),
      col('Name'),
      col('OrderCount'),
      col('GmvUsdCents'),
      col('LastPurchaseAt'),
    ].join(',');
    const lines = rows.map((r) =>
      [
        esc(r.userId),
        esc(r.phone),
        esc(r.name),
        esc(r.fCount),
        esc(r.mTotal),
        esc(r.lastPurchaseAt ?? ''),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  /** 层内用户明细（导出 + grant 共用的名单源） */
  private async listUsersInStage(
    stage: LifecycleStage,
  ): Promise<Array<{ userId: string; phone: string; name: string | null; fCount: number; mTotal: number; lastPurchaseAt: string | null }>> {
    const thresholds = await getProfileThresholds();
    const rows = await db.$queryRaw<
      Array<{ user_id: string; f_count: bigint; m_total: bigint | null; last_at: Date | null }>
    >`
      SELECT o.user_id,
             COUNT(*)::bigint AS f_count,
             COALESCE(SUM(o.payable_amount), 0)::bigint AS m_total,
             MAX(o.created_at) AS last_at
      FROM orders o
      WHERE o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
      GROUP BY o.user_id
    `;
    const now = new Date();
    const stageOf = (f: number, lastAt: Date | null): LifecycleStage =>
      getLifecycleStage(f, lastAt ? daysSinceInTz(lastAt, now) : null, thresholds);
    const matched = rows.filter((r) => stageOf(Number(r.f_count), r.last_at) === stage);
    if (matched.length === 0) return [];
    const userIds = matched.map((r) => r.user_id);
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, phone: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const fmMap = new Map(matched.map((r) => [r.user_id, r]));
    return userIds
      .map((id) => {
        const u = userMap.get(id);
        const fm = fmMap.get(id)!;
        return {
          userId: id,
          phone: u?.phone ?? '',
          name: u?.name ?? null,
          fCount: Number(fm.f_count),
          mTotal: Number(fm.m_total ?? 0),
          lastPurchaseAt: fm.last_at ? fm.last_at.toISOString() : null,
        };
      })
      .sort((a, b) => b.mTotal - a.mTotal);
  }

  /**
   * D7 批量发券（v2 订正 #7：新建 grant 端点；R-f 防滥用）
   *
   * 防滥用三件套：
   *   1. SUPER_ADMIN 门禁（controller @Roles）
   *   2. 频控：Redis 滑动窗口（controller 层，rateLimitPerMinute 可配——单层消耗，service 不重复计数）
   *   3. 单批上限：SystemConfig 可配（G5），硬顶 BATCH_GRANT_HARD_CAP
   * 幂等：UserCoupon @@unique([userId, promotionId]) 撞 P2002 跳过不报错（重复发放不双券）。
   * 配额：沿用 claimCoupon 的原子 increment + 配额守卫语义（usedCount = 已发放数）。
   *
   * @returns granted（实际新发）/ skipped（已持有，幂等跳过）/ failed（配额满等）
   */
  async batchGrantCoupons(
    promotionId: string,
    userIds: string[],
    operatorId: string,
  ): Promise<{ granted: number; skipped: number; failed: number; total: number }> {
    // 单批上限（G5 可配 + 硬顶）
    const configured = await parseSegmentBatchGrantLimit();
    const cap = Math.min(configured, BATCH_GRANT_HARD_CAP);
    if (userIds.length > cap) {
      throw new HttpException(
        {
          code: 'E-SEGMENT-002',
          message: `Batch size exceeds limit (max ${cap})`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 频控收敛在 controller 层（getSegmentBatchGrantConfig 可配）；service 不再二次消耗窗口
    const promo = await db.promotion.findUnique({ where: { id: promotionId } });
    if (!promo) {
      throw new NotFoundException({ code: 'E-COUPON-004', message: 'Coupon template not available' });
    }

    let granted = 0;
    let skipped = 0;
    let failed = 0;
    // 逐用户事务：create + 原子配额守卫（语义同 claimCoupon）；P2002 = 已持有 → 跳过
    for (const userId of userIds) {
      try {
        await db.$transaction(async (tx) => {
          await tx.userCoupon.create({
            data: {
              userId,
              promotionId: promo.id,
              code: promo.code,
              status: 'UNUSED',
            },
          });
          const affected = await tx.$executeRaw`
            UPDATE "promotions"
            SET used_count = used_count + 1
            WHERE id = ${promo.id}
              AND (total_quota IS NULL OR used_count < total_quota)
          `;
          if (affected === 0) {
            throw new Error('QUOTA_EXHAUSTED');
          }
        });
        granted += 1;
      } catch (e) {
        // P2002 = @@unique([userId, promotionId]) 冲突（幂等跳过：已持有不报错不双券）
        const errCode =
          e instanceof Prisma.PrismaClientKnownRequestError ? e.code : (e as { code?: string })?.code;
        if (errCode === 'P2002') {
          skipped += 1;
          continue;
        }
        if (e instanceof Error && e.message === 'QUOTA_EXHAUSTED') {
          failed += 1;
          continue;
        }
        logger.warn({
          msg: 'SEGMENT_GRANT_USER_FAILED',
          promotionId,
          userId,
          operatorId,
          err: e instanceof Error ? e.message : String(e),
        });
        failed += 1;
      }
    }

    logger.info({
      msg: 'SEGMENT_BATCH_GRANT',
      promotionId,
      operatorId,
      total: userIds.length,
      granted,
      skipped,
      failed,
    });
    return { granted, skipped, failed, total: userIds.length };
  }

  /**
   * C5 规则 CRUD —— 见 AdminSegmentController /coupon-rules；service 层提供层→券解析
   */
  async listRules() {
    const rules = await db.segmentCouponRule.findMany({
      orderBy: [{ stage: 'asc' }, { createdAt: 'asc' }],
      include: { promotion: { select: { id: true, code: true, name: true, type: true, value: true, status: true } } },
    });
    return { items: rules };
  }

  /** 触达预览：按规则给出各层当前人数 + 目标券（C5 + 批4 自动化共用入口） */
  async resolveRulesForStage(stage: LifecycleStage) {
    const rules = await db.segmentCouponRule.findMany({
      where: { stage, enabled: true },
      include: { promotion: { select: { id: true, code: true, name: true, status: true } } },
    });
    return rules;
  }

  /** 领券用户 receivedAt 后窗口内订单数（复购增量口径，单用户单查） */
  private async countOrdersAfter(userId: string, from: Date, to: Date): Promise<number> {
    const rows = await db.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(SEGMENT_ORDER_STATUSES_SQL)}
        AND o.created_at >= ${from}
        AND o.created_at <= ${to}
    `;
    return Number(rows[0]?.cnt ?? 0);
  }
}

/**
 * 距给定时间的天数（Dili 日历日差）——与 profile.service.ts daysSinceInTz 同语义副本
 * （不 import：profile.service 的实现未导出，抽到 shared 会动批1 文件语义——排除区约束）
 */
function daysSinceInTz(from: Date, now: Date): number {
  const tz = 'Asia/Dili';
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
    return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
  };
  return dayOf(now) - dayOf(from);
}

export { SEGMENT_ORDER_STATUSES_SQL };
