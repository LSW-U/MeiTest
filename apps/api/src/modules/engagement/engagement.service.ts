/**
 * Engagement Service — 批4 触达自动化（四流 C1/C2/C3/C6 + 场景 B2/B3，2026-10-18）
 *
 * 方案：方案v2 §三 批4 + 订正 #6。每流 = 触发条件查询 + 防重发幂等（OutreachTrigger
 * @@unique([flow, triggerKey, userId])）+ 动作（C1 定向券复用 SegmentService.batchGrantCoupons
 * 同款事务语义；推送走 NotificationEventService 渲染五语言模板 + 站内信 + PUSH）。
 *
 * 统一出闸顺序（所有流一致）：
 *   1. 幂等预检（outreachTrigger.findUnique → 已有行跳过，防重复扫描重发）
 *   2. E3 频控（tryConsumePushCap，超限 → 不落行只日志留痕，下轮可重试——P2-2 裁决）
 *   3. 动作（券 + 通知；离线/无 token 由通知链路天然安全——站内信必达、PUSH 无 token 跳过）
 *   4. 落 OutreachTrigger（仅 SENT 终态占幂等槽；P2002 撞约束=并发已触发，吞掉）
 *
 * 离线安全（P4-4）：无 ACTIVE DeviceToken 用户不产生 PUSH 失败（sendPushToUser 语义），
 * 站内信仍落（用户上线可见）；本服务不重复查 token，计 SENT。
 *
 * 口径红线（R-a 同源）：触发查询 status IN ('COMPLETED','CANCELLED') 字面量、
 * 不过滤 deleted_at（与 profile/segment/catalog 同源）。
 */
import { Injectable, Inject } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { MARKET_TIMEZONE } from '../../shared/datetime';
import { getEngagementFlowConfig } from './engagement.config';
import { getEngagementBehaviorConfig } from './behavior.config';
import { tryConsumePushCap } from './push-cap';
import { ENGAGEMENT_FLOW_META, type EngagementEventType } from './engagement.templates';
import type { NotificationEventService } from '../notification/notification-event.service';
import type { SegmentService } from '../segment/segment.service';

/** 聚合口径状态集（R-a 同源：与 profile.service.ts 逐字一致） */
const ENGAGEMENT_ORDER_STATUSES_SQL = "('COMPLETED', 'CANCELLED')";

/** 触发记录结果 */
export interface FlowRunResult {
  flow: string;
  /** 命中触发条件的用户数 */
  candidates: number;
  sent: number;
  skipped: number;
  /** skip 原因分布（RATE_LIMITED / NO_COUPON_RULE 等） */
  skipReasons: Record<string, number>;
}

/** Dili 本地日历日差（与 profile.service daysSinceInTz 同语义；批4 独立副本避免跨模块私有函数导出） */
export function daysSinceInTz(from: Date, now: Date = new Date()): number {
  const dayOf = (d: Date): number => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MARKET_TIMEZONE,
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

/** Dili 本地今天 YYYY-MM-DD */
function todayInTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_TIMEZONE }).format(now);
}

/** Dili 本地今天的 (MM-DD)（生日匹配用，含 2/29 → 平年落 3/1 的简化：2/29 生日在平年 2/28 后一天窗口自然覆盖由 lead 窗口吸收） */
function mdInTz(now: Date = new Date()): { mm: string; dd: string } {
  const iso = todayInTz(now);
  return { mm: iso.slice(5, 7), dd: iso.slice(8, 10) };
}

/** 年度周期键（C1/C6 幂等：同用户同年只发一次） */
function yearKey(now: Date = new Date()): string {
  return todayInTz(now).slice(0, 4);
}

/** YYYY-MM-DD → 粗日历序数（年*366 + 年内序数；仅 C4 相对比较用，非严格历法） */
function isoDayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return y * 366 + (m - 1) * 31 + d;
}

@Injectable()
export class EngagementService {
  constructor(
    // tsx 无 decorator metadata：显式 token 注入（module 注册；测试可传 null）
    @Inject('NotificationEventServiceToken')
    private readonly notificationEvent: NotificationEventService | null,
    // C1 定向券复用批2 grant（SegmentModule exports）
    @Inject('SegmentServiceToken')
    private readonly segment: SegmentService | null,
  ) {}

  // ========================================================================
  // 幂等 + 出闸公共件
  // ========================================================================

  /** 幂等预检：同 flow+triggerKey+user 已有记录 → true（跳过） */
  private async alreadyTriggered(flow: string, triggerKey: string, userId: string): Promise<boolean> {
    const hit = await db.outreachTrigger.findUnique({
      where: { flow_triggerKey_userId: { flow, triggerKey, userId } },
      select: { id: true },
    });
    return hit !== null;
  }

  /**
   * 统一出闸：频控 → 动作 → 落触发记录
   *
   * @param action 返回 errorReason 时按 SKIPPED/<reason> 日志留痕（不落行，下轮可重试）
   * @returns 'sent' | 'skipped:<reason>' | 'duplicate'
   */
  private async gateAndFire(input: {
    flow: string;
    triggerKey: string;
    userId: string;
    event: EngagementEventType;
    notificationType: 'PROMOTION' | 'SYSTEM';
    params: Record<string, string>;
    data?: Record<string, unknown>;
    dailyCap: number;
    weeklyCap: number;
    action?: () => Promise<string | null>;
  }): Promise<string> {
    const { flow, triggerKey, userId } = input;
    if (await this.alreadyTriggered(flow, triggerKey, userId)) {
      return 'duplicate';
    }
    // E3 频控（超限 → 不发送且留痕，P4-2）
    const cap = await tryConsumePushCap(userId, input.dailyCap, input.weeklyCap);
    if (!cap.allowed) {
      // P2-2 裁决（批5 审查 2026-10-18）：SKIPPED 不落 outreach_triggers 行（幂等唯一锁
      // 只锁 SENT 终态）——否则 C7/C8 被频控跳过后 triggerKey 槽位被永久占用，该事件
      // 下轮永不重试（C8 一次性语义下=必然丢提醒）。留痕走日志（skip 统计已随
      // FlowRunResult 返回，运营侧看日志/返回值）。
      logger.warn({
        msg: 'ENGAGEMENT_TRIGGER_SKIPPED',
        flow,
        triggerKey,
        userId,
        reason: 'RATE_LIMITED',
      });
      return 'skipped:RATE_LIMITED';
    }
    // 动作（C1 发券等；返回非 null = 业务性跳过原因）
    let actionError: string | null = null;
    if (input.action) {
      actionError = await input.action();
    }
    if (actionError) {
      logger.warn({
        msg: 'ENGAGEMENT_TRIGGER_SKIPPED',
        flow,
        triggerKey,
        userId,
        reason: actionError,
      });
      return `skipped:${actionError}`;
    }
    // 触达：五语言模板渲染 + 站内信 + PUSH（失败容忍在 NotificationEventService 内；
    // 离线/无 token：站内信仍落，PUSH 天然跳过 → P4-4 安全跳过语义）
    if (this.notificationEvent) {
      await this.notificationEvent.notify({
        event: input.event,
        userId,
        type: input.notificationType,
        data: input.data,
        params: input.params,
      });
    }
    await this.recordTrigger(flow, triggerKey, userId, 'SENT', null);
    return 'sent';
  }

  /** 落触发记录（P2002 撞幂等唯一约束 = 并发已触发，吞掉不报错；只写 SENT 终态——SKIPPED 不占幂等槽，P2-2 裁决） */
  private async recordTrigger(
    flow: string,
    triggerKey: string,
    userId: string,
    status: 'SENT',
    skipReason: string | null,
  ): Promise<void> {
    try {
      await db.outreachTrigger.create({
        data: { flow, triggerKey, userId, status, skipReason },
      });
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      if (code !== 'P2002') {
        logger.warn({
          msg: 'ENGAGEMENT_TRIGGER_RECORD_FAILED',
          flow,
          triggerKey,
          userId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  /** skip 分布累加 */
  private bump(map: Record<string, number>, result: string): void {
    const key = result.startsWith('skipped:') ? result.slice('skipped:'.length) : result;
    map[key] = (map[key] ?? 0) + 1;
  }

  // ========================================================================
  // C1 挽留：沉睡阈值 → 定向券（复用批2 grant 事务语义）+ 推送
  // ========================================================================

  /**
   * C1 挽留流
   *
   * 触发：有聚合基数订单（F≥1）、R（距最近购买日历日）≥ retentionDays、
   *       活跃定向券规则存在且本年未触达。triggerKey = `C1:{year}`。
   * 动作：按 SLEEPING/CHURNED 层解析 C5 规则券（复用 grant 事务：P2002 幂等 / 配额守卫），
   *       无规则 → SKIPPED/NO_COUPON_RULE（仅日志留痕不落行，P2-2 裁决；频控额度已消耗属
   *       可接受误差——先频控后动作顺序保证"超限必不发"）。
   */
  async runRetentionFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.C1;
    const result: FlowRunResult = {
      flow: 'C1',
      candidates: 0,
      sent: 0,
      skipped: 0,
      skipReasons: {},
    };

    // 触发查询：全体沉睡候选（R ≥ retentionDays 的活跃客户）——一次性扫出，
    // 幂等在循环内逐用户预检（命中过本年 C1 的不再进入动作段）
    const rows = await db.$queryRaw<Array<{ user_id: string }>>`
      SELECT o.user_id
      FROM orders o
      JOIN users u ON u.id = o.user_id AND u.status = 'ACTIVE' AND u.role = 'CUSTOMER'
      WHERE o.status IN ${Prisma.raw(ENGAGEMENT_ORDER_STATUSES_SQL)}
      GROUP BY o.user_id
      HAVING EXTRACT(DAY FROM
        (date_trunc('day', (now() AT TIME ZONE ${MARKET_TIMEZONE})::timestamp)
         - date_trunc('day', (MAX(o.created_at) AT TIME ZONE ${MARKET_TIMEZONE})::timestamp))
      ) >= ${cfg.retentionDays}
      LIMIT 5000
    `;
    result.candidates = rows.length;
    const year = yearKey(now);

    for (const { user_id } of rows) {
      const userId = user_id;
      const r = await this.gateAndFire({
        flow: 'C1',
        triggerKey: `C1:${year}`,
        userId,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
        action: () => this.grantRetentionCoupon(userId),
      });
      if (r === 'sent') result.sent += 1;
      else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C1_DONE', ...result });
    return result;
  }

  /**
   * C1 定向券：按用户当前生命周期层查 enabled C5 规则 → 取最新一条 → grant 同款事务
   * 无规则返回 'NO_COUPON_RULE'；成功返回 null。
   */
  private async grantRetentionCoupon(userId: string): Promise<string | null> {
    if (!this.segment) return 'NO_COUPON_RULE';
    // 该用户候选券：该层全部 enabled 规则 → 逐个尝试 grant（P2002=已持有自动 skip）
    const stage = await this.resolveLifecycleStage(userId);
    const rule = await db.segmentCouponRule.findFirst({
      where: { stage, enabled: true },
      orderBy: { createdAt: 'desc' },
      select: { promotionId: true },
    });
    if (!rule) return 'NO_COUPON_RULE';
    const r = await this.segment.batchGrantCoupons(rule.promotionId, [userId], 'system:C1');
    // granted>0 或 skipped>0（已持有）都算动作完成；仅全 failed 才回退 NO_COUPON_RULE 语义不合理——
    // failed=配额满，记 COUPON_FAILED 留痕
    if (r.granted > 0 || r.skipped > 0) return null;
    return 'COUPON_FAILED';
  }

  /** 单用户生命周期层（复用批1 getProfileThresholds + getLifecycleStage 同源口径） */
  private async resolveLifecycleStage(userId: string): Promise<string> {
    const rows = await db.$queryRaw<Array<{ f_count: bigint; last_at: Date | null }>>`
      SELECT COUNT(*)::bigint AS f_count, MAX(o.created_at) AS last_at
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.status IN ${Prisma.raw(ENGAGEMENT_ORDER_STATUSES_SQL)}
    `;
    const { getProfileThresholds } = await import('../profile/profile.config');
    const { getLifecycleStage } = await import('../profile/lifecycle');
    const t = await getProfileThresholds();
    const fCount = Number(rows[0]?.f_count ?? 0);
    const lastAt = rows[0]?.last_at ?? null;
    const rDays = lastAt ? daysSinceInTz(lastAt) : null;
    return getLifecycleStage(fCount, rDays, t);
  }

  // ========================================================================
  // C2 首购转化：注册 N 天无首单 → 新人推送
  // ========================================================================

  /** triggerKey = `C2:{yyyy-mm-dd}`（按注册日一次） */
  async runFirstPurchaseFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.C2;
    const result: FlowRunResult = { flow: 'C2', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    const today = todayInTz(now);
    // 注册恰在 N 天前（本地日历日）且零聚合基数订单的活跃客户
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT u.id
      FROM users u
      WHERE u.status = 'ACTIVE' AND u.role = 'CUSTOMER'
        AND (u.created_at AT TIME ZONE ${MARKET_TIMEZONE})::date
            = (now() AT TIME ZONE ${MARKET_TIMEZONE})::date - ${cfg.firstPurchaseDays}
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.user_id = u.id AND o.status IN ${Prisma.raw(ENGAGEMENT_ORDER_STATUSES_SQL)}
        )
      LIMIT 5000
    `;
    result.candidates = rows.length;

    for (const { id } of rows) {
      const r = await this.gateAndFire({
        flow: 'C2',
        triggerKey: `C2:${today}`,
        userId: id,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
      });
      if (r === 'sent') result.sent += 1;
      else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C2_DONE', ...result });
    return result;
  }

  // ========================================================================
  // C3 复购感谢：第 N 单完成 → 感谢 + 评价邀请
  // ========================================================================

  /**
   * C3 流。触发：用户恰完成第 N 单（completedAt 落在扫描窗口内的订单，
   * 其按聚合基数的序号 = thanksOrderCount）。triggerKey = `C3:{orderId}`（一单一次）。
   * 由 order 完成挂点或定时扫描调用；此处实现定时扫描版：completedAt 在过去 24h、
   * 且该单是用户第 N 笔聚合基数订单。
   */
  async runThanksFlow(_now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.C3;
    const result: FlowRunResult = { flow: 'C3', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    // 恰好第 N 单：该订单之前（created_at 更早或同毫秒 id 更小）的聚合基数订单恰 N-1 笔
    const rows = await db.$queryRaw<Array<{ id: string; user_id: string; order_no: string }>>`
      SELECT o.id, o.user_id, o.order_no
      FROM orders o
      WHERE o.status = 'COMPLETED'
        AND o.completed_at IS NOT NULL
        AND o.completed_at >= now() - interval '24 hours'
        AND (
          SELECT COUNT(*) FROM orders o2
          WHERE o2.user_id = o.user_id
            AND o2.status IN ${Prisma.raw(ENGAGEMENT_ORDER_STATUSES_SQL)}
            AND (o2.created_at < o.created_at
                 OR (o2.created_at = o.created_at AND o2.id < o.id))
        ) = ${cfg.thanksOrderCount - 1}
      LIMIT 2000
    `;
    result.candidates = rows.length;

    for (const row of rows) {
      const r = await this.gateAndFire({
        flow: 'C3',
        triggerKey: `C3:${row.id}`,
        userId: row.user_id,
        event: meta.event,
        notificationType: meta.notificationType,
        params: { orderNo: row.order_no },
        data: { orderId: row.id },
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
      });
      if (r === 'sent') result.sent += 1;
      else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C3_DONE', ...result });
    return result;
  }

  // ========================================================================
  // C6 生日：birthDate 提前 N 天（Dili 本地日历，月日匹配）
  // ========================================================================

  /**
   * 生日窗口判定（纯函数，单测友好）：今天(本地 MM-DD) 落在
   * [生日 - leadDays, 生日) 窗口内（生日当天及之后不再发——祝福要赶在前面）。
   * 2/29 生日在平年按 3/1 处理（差一天由 lead 窗口吸收，简化决策）。
   */
  isInBirthdayWindow(birthMmDd: string, leadDays: number, now: Date = new Date()): boolean {
    if (!/^\d{2}-\d{2}$/.test(birthMmDd)) return false;
    const y = Number(todayInTz(now).slice(0, 4));
    // 本年的生日（2/29 平年 → 3/1）
    let [bm, bd] = birthMmDd.split('-').map(Number);
    if (bm === 2 && bd === 29 && !isLeap(y)) {
      bm = 3;
      bd = 1;
    }
    const birthday = Date.UTC(y, bm - 1, bd) / 86_400_000;
    const today = Date.UTC(y, Number(mdInTz(now).mm) - 1, Number(mdInTz(now).dd)) / 86_400_000;
    const diff = birthday - today; // 天数（生日前为正）
    return diff >= 1 && diff <= leadDays;
  }

  /** triggerKey = `C6:{yyyy}`（一年一次） */
  async runBirthdayFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.C6;
    const result: FlowRunResult = { flow: 'C6', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    // 粗筛：本月 + 下月两月窗口（P2-1 修复 2026-10-18：跨月边界如今天 10-30 lead=3
    // 命中 11-01 生日，单月 EXTRACT(MONTH)=当前月 会漏掉下月初生日）；日历精确窗口
    // 在 JS 侧判——isInBirthdayWindow 处理 2/29、lead 边界；SQL 只做预过滤控制扫描量
    const rows = await db.$queryRaw<Array<{ id: string; birth_date: Date }>>`
      SELECT u.id, u.birth_date
      FROM users u
      WHERE u.status = 'ACTIVE' AND u.role = 'CUSTOMER'
        AND u.birth_date IS NOT NULL
        AND (
          (EXTRACT(MONTH FROM u.birth_date) = 2 AND EXTRACT(DAY FROM u.birth_date) = 29
            AND ${cfg.birthdayLeadDays} >= 1)
          OR (EXTRACT(MONTH FROM u.birth_date) IN (
                EXTRACT(MONTH FROM (now() AT TIME ZONE ${MARKET_TIMEZONE})),
                EXTRACT(MONTH FROM ((now() AT TIME ZONE ${MARKET_TIMEZONE}) + interval '1 month')))
              AND EXTRACT(DAY FROM u.birth_date)
                BETWEEN EXTRACT(DAY FROM (now() AT TIME ZONE ${MARKET_TIMEZONE})) + 1
                    AND EXTRACT(DAY FROM (now() AT TIME ZONE ${MARKET_TIMEZONE})) + ${cfg.birthdayLeadDays})
        )
      LIMIT 5000
    `;
    // 粗筛行再过精确窗口（2/29 生日在窗口内时 SQL 无法匹配平年，补扫 3/1 前后窗口）
    const exact = rows.filter((r) =>
      this.isInBirthdayWindow(this.birthMmDd(r.birth_date), cfg.birthdayLeadDays, now),
    );
    // 2/29 补扫：平年 3/1 落窗（isInBirthdayWindow 已映射 3/1）——从全量生月子集找（数量小，接受）
    const leapExtra = cfg.birthdayLeadDays >= 1
      ? await db.$queryRaw<Array<{ id: string; birth_date: Date }>>`
          SELECT u.id, u.birth_date FROM users u
          WHERE u.status = 'ACTIVE' AND u.role = 'CUSTOMER'
            AND u.birth_date IS NOT NULL
            AND EXTRACT(MONTH FROM u.birth_date) = 2 AND EXTRACT(DAY FROM u.birth_date) = 29
          LIMIT 1000
        `
      : [];
    const seen = new Set(exact.map((r) => r.id));
    for (const r of leapExtra) {
      if (this.isInBirthdayWindow(this.birthMmDd(r.birth_date), cfg.birthdayLeadDays, now) && !seen.has(r.id)) {
        exact.push(r);
        seen.add(r.id);
      }
    }
    result.candidates = exact.length;
    const year = yearKey(now);

    for (const row of exact) {
      const r = await this.gateAndFire({
        flow: 'C6',
        triggerKey: `C6:${year}`,
        userId: row.id,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
      });
      if (r === 'sent') result.sent += 1;
      else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C6_DONE', ...result });
    return result;
  }

  /** birthDate → 本地 MM-DD 串（Dili 日历） */
  private birthMmDd(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MARKET_TIMEZONE,
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    return parts; // en-CA 短格式直接是 MM-DD
  }

  // ========================================================================
  // B2 补货提醒（手工订阅版）
  // ========================================================================

  /**
   * B2 流：enabled 订阅中「距 lastRemindedAt（或订阅创建时间）≥ cycleDays 天」触达。
   * triggerKey = `B2:{subscriptionId}:{yyyymmdd 触发日}`；触达后推 lastRemindedAt。
   */
  async runReplenishFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.B2;
    const result: FlowRunResult = { flow: 'B2', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    const subs = await db.clientSubscription.findMany({
      where: { enabled: true, product: { status: 'ACTIVE' } },
      select: { id: true, userId: true, cycleDays: true, lastRemindedAt: true, updatedAt: true },
      take: 2000,
    });
    const due = subs.filter((s) => {
      const base = s.lastRemindedAt ?? s.updatedAt;
      return daysSinceInTz(base, now) >= s.cycleDays;
    });
    result.candidates = due.length;
    const today = todayInTz(now);

    for (const s of due) {
      const r = await this.gateAndFire({
        flow: 'B2',
        triggerKey: `B2:${s.id}:${today.replaceAll('-', '')}`,
        userId: s.userId,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
      });
      if (r === 'sent') {
        result.sent += 1;
        await db.clientSubscription
          .update({ where: { id: s.id }, data: { lastRemindedAt: now } })
          .catch(() => undefined);
      } else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_B2_DONE', ...result });
    return result;
  }

  // ========================================================================
  // B3 购物车遗留召回
  // ========================================================================

  /**
   * B3 流：购物车 last 更新 ≥ cartRecallHours 前、仍有 items 的用户。
   * triggerKey = `B3:{yyyymmdd}`（每用户每日至多一次召回）。
   */
  async runCartRecallFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.B3;
    const result: FlowRunResult = { flow: 'B3', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    const rows = await db.$queryRaw<Array<{ user_id: string }>>`
      SELECT c.user_id
      FROM carts c
      WHERE c.updated_at <= now() - (${cfg.cartRecallHours} || ' hours')::interval
        AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
      LIMIT 5000
    `;
    result.candidates = rows.length;
    const today = todayInTz(now).replaceAll('-', '');

    for (const { user_id } of rows) {
      const r = await this.gateAndFire({
        flow: 'B3',
        triggerKey: `B3:${today}`,
        userId: user_id,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
      });
      if (r === 'sent') result.sent += 1;
      else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_B3_DONE', ...result });
    return result;
  }

  // ========================================================================
  // 批5（2026-10-18）：A5 周期预测 + C4 自动补货 / C7 降价 / C8 到货 / B4 浏览未买
  // ========================================================================

  /**
   * A5 周期预测（G4 简单均值，纯函数，单测友好）。
   *
   * 口径：按 Dili 日历日差取该用户该商品最近 N 次（replenishIntervalMax，上限 3）购买
   * 间隔的简单均值；次数 < replenishIntervalMin（下限 2）不预测返回 null。
   * 输入为升序（旧→新）购买日历日数组。
   */
  predictReplenishIntervalDays(sortedDayAsc: number[], cfg: { replenishIntervalMin: number; replenishIntervalMax: number }): number | null {
    if (sortedDayAsc.length < cfg.replenishIntervalMin) return null;
    const take = sortedDayAsc.slice(-cfg.replenishIntervalMax);
    const gaps: number[] = [];
    for (let i = 1; i < take.length; i += 1) gaps.push(take[i] - take[i - 1]);
    if (gaps.length === 0) return null;
    return Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
  }

  /**
   * C4 自动补货流（批4 B2 手工订阅的自动预测升级版；REPLENISH 类型订阅 + 有购买史）。
   *
   * 触发：enabled REPLENISH 订阅，商品有 ≥ replenishIntervalMin 次聚合基数购买，
   *       预测到期日（上次购买 + 均值间隔）距今 ≤ replenishLeadDays。
   * triggerKey = `C4:{subscriptionId}:{yyyymmdd 触发日}`（B2 同款日粒度）。
   * 复用频控闸 + 幂等出闸；触达后推 lastRemindedAt（同 B2 语义）。
   */
  async runAutoReplenishFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementBehaviorConfig();
    const meta = ENGAGEMENT_FLOW_META.C4;
    const result: FlowRunResult = { flow: 'C4', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    const subs = await db.clientSubscription.findMany({
      where: { enabled: true, type: 'REPLENISH', product: { status: 'ACTIVE' } },
      select: { id: true, userId: true, productId: true, lastRemindedAt: true, updatedAt: true },
      take: 2000,
    });
    const today = todayInTz(now);

    for (const s of subs) {
      // 距上次提醒未过 7 天不重复预测（预测日粒度，窗口内重复扫描防抖）
      const base = s.lastRemindedAt ?? s.updatedAt;
      if (daysSinceInTz(base, now) < 7) continue;

      // 该用户该商品最近 N 次购买日（Dili 日历日序数，升序）
      const buyRows = await db.$queryRaw<Array<{ day: number }>>`
        WITH buys AS (
          SELECT DISTINCT (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${MARKET_TIMEZONE})::date AS d
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id AND oi.product_id = ${s.productId}
          WHERE o.user_id = ${s.userId}
            AND o.status IN ${Prisma.raw(ENGAGEMENT_ORDER_STATUSES_SQL)}
          ORDER BY d DESC
          LIMIT ${cfg.replenishIntervalMax}
        )
        SELECT EXTRACT(DOY FROM d)::int + EXTRACT(YEAR FROM d)::int * 366 AS day
        FROM buys ORDER BY day ASC
      `;
      const dayList = buyRows.map((r) => r.day);
      const interval = this.predictReplenishIntervalDays(dayList, cfg);
      if (interval === null) continue;

      // 预测到期日 = 最近购买日 + interval；距今 ≤ leadDays 触发
      const lastDay = dayList[dayList.length - 1];
      const dueDay = lastDay + interval;
      const todayKey = isoDayNumber(today);
      if (dueDay - todayKey > cfg.replenishLeadDays) continue;

      result.candidates += 1;
      const r = await this.gateAndFire({
        flow: 'C4',
        triggerKey: `C4:${s.id}:${today.replaceAll('-', '')}`,
        userId: s.userId,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        data: { productId: s.productId },
        dailyCap: (await getEngagementFlowConfig()).pushCapDaily,
        weeklyCap: (await getEngagementFlowConfig()).pushCapWeekly,
      });
      if (r === 'sent') {
        result.sent += 1;
        await db.clientSubscription
          .update({ where: { id: s.id }, data: { lastRemindedAt: now } })
          .catch(() => undefined);
      } else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C4_DONE', ...result });
    return result;
  }

  /**
   * C7 降价提醒流：PRICE_ALERT 订阅，商品当前 priceMin < priceAtSub 且
   * 降幅 ≥ priceDropPercent → 触达（一次，之后 priceAtSub 更新为现价——再降再提醒）。
   * triggerKey = `C7:{subscriptionId}:{新价格}`（同价不重复）。
   */
  async runPriceAlertFlow(_now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementBehaviorConfig();
    const meta = ENGAGEMENT_FLOW_META.C7;
    const result: FlowRunResult = { flow: 'C7', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    const subs = await db.clientSubscription.findMany({
      where: {
        enabled: true,
        type: 'PRICE_ALERT',
        priceAtSub: { not: null },
        product: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, productId: true, priceAtSub: true },
      take: 2000,
    });
    for (const s of subs) {
      const priceAtSub = s.priceAtSub as number;
      if (priceAtSub <= 0) continue;
      const rows = await db.$queryRaw<Array<{ price_min: number }>>`
        SELECT p.price_min FROM products p WHERE p.id = ${s.productId} AND p.status = 'ACTIVE'
      `;
      const current = Number(rows[0]?.price_min ?? 0);
      if (current <= 0 || current >= priceAtSub) continue; // 无降价
      const dropPercent = ((priceAtSub - current) / priceAtSub) * 100;
      if (dropPercent < cfg.priceDropPercent) continue;

      result.candidates += 1;
      const r = await this.gateAndFire({
        flow: 'C7',
        triggerKey: `C7:${s.id}:${current}`,
        userId: s.userId,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        data: { productId: s.productId, price: current },
        dailyCap: (await getEngagementFlowConfig()).pushCapDaily,
        weeklyCap: (await getEngagementFlowConfig()).pushCapWeekly,
      });
      if (r === 'sent') {
        result.sent += 1;
        // 快照推进到现价：再降再提醒（未提醒的重复扫描由 triggerKey 幂等吸收）
        await db.clientSubscription
          .update({ where: { id: s.id }, data: { priceAtSub: current } })
          .catch(() => undefined);
      } else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C7_DONE', ...result });
    return result;
  }

  /**
   * C8 到货提醒流：RESTOCK_ALERT 订阅，商品任一仓库库存回补（quantity > 0）→ 触达
   * 后自动关闭订阅（enabled=false，一次性语义；再次缺货由用户重新订阅）。
   * triggerKey = `C8:{subscriptionId}`。
   */
  async runRestockAlertFlow(_now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementFlowConfig();
    const meta = ENGAGEMENT_FLOW_META.C8;
    const result: FlowRunResult = { flow: 'C8', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    const subs = await db.clientSubscription.findMany({
      where: { enabled: true, type: 'RESTOCK_ALERT', product: { status: 'ACTIVE' } },
      select: { id: true, userId: true, productId: true },
      take: 2000,
    });
    for (const s of subs) {
      const rows = await db.$queryRaw<Array<{ qty: bigint }>>`
        SELECT COALESCE(SUM(st.quantity), 0)::bigint AS qty
        FROM stocks st
        JOIN skus k ON k.id = st.sku_id AND k.status = 'ACTIVE'
        WHERE k.product_id = ${s.productId}
      `;
      if (Number(rows[0]?.qty ?? 0) <= 0) continue; // 仍缺货

      result.candidates += 1;
      const r = await this.gateAndFire({
        flow: 'C8',
        triggerKey: `C8:${s.id}`,
        userId: s.userId,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        data: { productId: s.productId },
        dailyCap: cfg.pushCapDaily,
        weeklyCap: cfg.pushCapWeekly,
      });
      if (r === 'sent') {
        result.sent += 1;
        // 一次性语义：到货提醒送达后关闭订阅（幂等重扫由 findMany enabled=true 过滤吸收）
        await db.clientSubscription
          .update({ where: { id: s.id }, data: { enabled: false } })
          .catch(() => undefined);
      } else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_C8_DONE', ...result });
    return result;
  }

  /**
   * B4 浏览未买 nudge 流：用户 VIEW 埋点 ≥ viewNudgeDays 天且该商品无聚合基数购买 → 推送。
   * triggerKey = `B4:{userId}:{productId}:{yyyymmdd}`（每日一商品一次）；流内每日 nudge
   * 上限 viewNudgeCapDaily（频控闸之外的流内节流——防止重度浏览者被 nudge 刷屏）。
   */
  async runViewNudgeFlow(now: Date = new Date()): Promise<FlowRunResult> {
    const cfg = await getEngagementBehaviorConfig();
    const meta = ENGAGEMENT_FLOW_META.B4;
    const result: FlowRunResult = { flow: 'B4', candidates: 0, sent: 0, skipped: 0, skipReasons: {} };

    // 粗筛：有 VIEW 埋点的（用户, 商品）对，最早 VIEW 距今 ≥ N 天，且无聚合基数购买
    const rows = await db.$queryRaw<Array<{ user_id: string; product_id: string }>>`
      SELECT DISTINCT b.user_id, b.product_id
      FROM behavior_events b
      WHERE b.type = 'VIEW'
        AND b.user_id IS NOT NULL
        AND b.created_at <= now() - (${cfg.viewNudgeDays} || ' days')::interval
        AND b.created_at > now() - interval '60 days'
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = b.product_id
            AND o.user_id = b.user_id
            AND o.status IN ${Prisma.raw(ENGAGEMENT_ORDER_STATUSES_SQL)}
        )
      LIMIT 3000
    `;
    result.candidates = rows.length;
    const today = todayInTz(now).replaceAll('-', '');
    const nudgedToday = new Map<string, number>();

    for (const { user_id, product_id } of rows) {
      const userId = user_id;
      const productId = product_id;
      // 流内每日上限（B4 专用节流）
      const used = nudgedToday.get(userId) ?? 0;
      if (used >= cfg.viewNudgeCapDaily) {
        result.skipped += 1;
        this.bump(result.skipReasons, 'VIEW_NUDGE_CAP');
        continue;
      }
      const r = await this.gateAndFire({
        flow: 'B4',
        triggerKey: `B4:${userId}:${productId}:${today}`,
        userId,
        event: meta.event,
        notificationType: meta.notificationType,
        params: {},
        data: { productId },
        dailyCap: (await getEngagementFlowConfig()).pushCapDaily,
        weeklyCap: (await getEngagementFlowConfig()).pushCapWeekly,
      });
      if (r === 'sent') {
        result.sent += 1;
        nudgedToday.set(userId, used + 1);
      } else if (r !== 'duplicate') {
        result.skipped += 1;
        this.bump(result.skipReasons, r);
      }
    }
    logger.info({ msg: 'ENGAGEMENT_FLOW_B4_DONE', ...result });
    return result;
  }

  /** 全流跑一遍（processor job 'run-all' 用；逐流隔离失败） */
  async runAllFlows(now: Date = new Date()): Promise<FlowRunResult[]> {
    const runners: Array<[string, () => Promise<FlowRunResult>]> = [
      ['C1', () => this.runRetentionFlow(now)],
      ['C2', () => this.runFirstPurchaseFlow(now)],
      ['C3', () => this.runThanksFlow(now)],
      ['C6', () => this.runBirthdayFlow(now)],
      ['B2', () => this.runReplenishFlow(now)],
      ['B3', () => this.runCartRecallFlow(now)],
      ['C4', () => this.runAutoReplenishFlow(now)],
      ['C7', () => this.runPriceAlertFlow(now)],
      ['C8', () => this.runRestockAlertFlow(now)],
      ['B4', () => this.runViewNudgeFlow(now)],
    ];
    const results: FlowRunResult[] = [];
    for (const [flow, run] of runners) {
      try {
        results.push(await run());
      } catch (e) {
        logger.error({
          msg: 'ENGAGEMENT_FLOW_FAILED',
          flow,
          err: e instanceof Error ? e.message : String(e),
        });
        results.push({ flow, candidates: 0, sent: 0, skipped: 0, skipReasons: { FLOW_ERROR: 1 } });
      }
    }
    return results;
  }
}

/** 平年判定（isInBirthdayWindow 用） */
function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
