/**
 * OutOfStockRefundService — system 自动退款专用通路（缺货履约闭环批3 2026-10-24）
 *
 * 权威方案：方案v3-缺货履约闭环与自动退款-20261024 §一 D2/D9b/D11/D13/D14/D15/D17
 *
 * 🔴 纪律（任务书批3）：
 *   - 全新写通路：不改 refund.service.ts 共享代码——AUTO_APPROVE_STATUSES（:38）、
 *     同单单笔守卫（:142）、整单 COMPLETED 守卫（:166）原封不动，豁免只在通路内部
 *   - 建单 reviewedBy='SYSTEM' → 免审上限判定（单笔退款单金额 ≤ autoRefundMaxAmount，
 *     默认 $50=5000 分）→ 复用 completeRefundTx 直退；超限 → 落 PENDING 人工
 *   - 不回补库存（货缺/坏，回补错账）——completeRefundTx 不传 restock
 *   - 合并账（D13）：同单已有进行中 OUT_OF_STOCK 退款 → 追加 RefundItem 行重算金额；
 *     无 → 新建（绕开 E-REFUND-002 守卫冲突，共享守卫不改）
 *   - COMPLETED 后二次缺货（D14）：自动开第二笔 system 退款，守卫豁免仅限 system 通路
 *   - 推送：退款完成（或转人工）后推「已自动退款/转人工」事件（D16 同步直推同款纪律：
 *     事务外推送、失败不回滚、notify 内部吞错）
 *
 * 触发点：OutOfStockService 登记链事务 commit 后调用（admin 全缺判定 / 骑手部分缺登记），
 * 由调用方裁决「本次登记是否构成退款候选」（本服务只做规则判定 + 建单 + 直退）。
 *
 * 规则（D15 三开关 + D17 上限，out_of_stock_rule 表为源）：
 *   - scope 匹配：warehouseId 精确行优先，无则回退全局行（warehouseId=null），无任何行
 *     → 代码默认值（全缺开 / 阈值关 / 超时关 / 上限 5000）
 *   - SystemConfig 镜像（D17）：镜像 key 为源的可读副本，规则表为真源；写路径同事务双写
 *
 * 错误码：E-OOS-008 退款状态冲突（并发翻转失败，P3-2 语义修正；规则关闭走静默
 * triggered=false，不抛错——E-OOS-007 现指引擎处理失败兜底语义）
 */
import { Inject, Injectable, Optional, ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction, type Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import type { NotificationEventService } from '../notification/notification-event.service';
import { applyRefundSettlementAdjustment } from '../settle/real-order-aggregator.service';
import {
  rollbackSalesCountForRefundItems,
  rollbackSalesCountForFullOrder,
} from '../../shared/db';

/** 代码兜底规则（out_of_stock_rule 无行时使用，对齐 schema @default） */
export const DEFAULT_OOS_RULE = {
  autoRefundFullShortage: true,
  partialShortageThresholdEnabled: false,
  partialShortageThresholdBp: null as number | null,
  reportTimeoutEnabled: false,
  reportTimeoutMinutes: null as number | null,
  autoRefundMaxAmount: 5000,
} as const;

/** 缺货退款金额计算输入（登记链传入的项级快照） */
export interface OosRefundCandidate {
  orderId: string;
  /** 本次登记触发的项（含历史已登记项——合并账时全量入账） */
  items: { orderItemId: string; skuId: string; productName: unknown; unitPrice: number; refundQty: number }[];
  /** 全缺判定结果（true = 整单全缺，D11 已 CANCELLED） */
  fullShortage: boolean;
  /** 订单 warehouseId（scope 匹配） */
  warehouseId: string | null;
}

/** system 退款通路结果 */
export interface OosRefundResult {
  /** 是否建单/更新了退款（规则关/无可退金额时 false） */
  triggered: boolean;
  refundId: string | null;
  /** refundAmount（分） */
  amount: number;
  /** direct = 免审直退 COMPLETED / pending = 超限转人工 PENDING / none = 未触发 */
  mode: 'direct' | 'pending' | 'none';
}

@Injectable()
export class OutOfStockRefundService {
  constructor(
    // 复用 completeRefundTx？—— 🔴 completeRefundTx 是 refund.service 的 private 方法，
    // 共享代码零改动纪律下不能改 public。直退在通路内部自实现（见 completeSystemRefundTx，
    // 同款单点收口语义：flip COMPLETED → 销量回滚守卫 → Settlement 调整，restock 恒不传），
    // 逻辑照抄 refund.service.ts:489 但独立演进，互不牵连。RefundService 注入仅作类型引用备查。
    // NotificationEventServiceToken：显式 token（tsx 无 decorator metadata），
    // @Optional 兜底单测直 new（notify 内部全链 try/catch 容忍）
    @Optional() @Inject('NotificationEventServiceToken')
    private readonly notificationEvents?: NotificationEventService | null,
  ) {}

  /**
   * 规则判定 + system 退款（登记链挂点调用，事务 commit 后）
   *
   * 流程：
   *   1. 读规则（warehouseId 精确行 → 全局行 → 代码默认）
   *   2. 开关判定：fullShortage → autoRefundFullShortage；部分缺 → 阈值开关 +
   *      金额占比（万分位）≥ thresholdBp；开关未命中 → triggered=false 返回
   *   3. 合并账检查（D13）：同单进行中（PENDING/APPROVED）OUT_OF_STOCK 退款 → 追加
   *      RefundItem 行 + 重算 amount；否则新建（reviewedBy='SYSTEM'）
   *   4. 免审上限（D17）：单笔退款单金额 ≤ rule.autoRefundMaxAmount → 直退（completeRefundTx
   *      同款收口，restock 不传）；超限 → 落 PENDING 人工
   *   5. 推送（事务外）：direct → outOfStockAutoRefunded；pending → outOfStockRefundPending
   *
   * 并发：withTransaction + pg_advisory_xact_lock(4, hashtext(orderId))——与 refund.service
   * 的 (3, hashtext) 键空间不重叠（typePart 区分），同单多次登记串行化，防双建单。
   */
  async processOutOfStockRefund(candidate: OosRefundCandidate): Promise<OosRefundResult> {
    // 1. 规则读取（精确行 → 全局行 → 默认）
    const rule = await this.resolveRule(candidate.warehouseId);

    // 2. 开关判定
    if (candidate.fullShortage) {
      if (!rule.autoRefundFullShortage) {
        logger.info({ msg: 'OOS_REFUND_RULE_DISABLED', orderId: candidate.orderId, kind: 'full' });
        return { triggered: false, refundId: null, amount: 0, mode: 'none' };
      }
    } else {
      if (!rule.partialShortageThresholdEnabled || rule.partialShortageThresholdBp == null) {
        return { triggered: false, refundId: null, amount: 0, mode: 'none' };
      }
      // 占比 = 可退金额 / 订单 payableAmount（万分位）；查订单 payable 做分母
      const order = await db.order.findUnique({
        where: { id: candidate.orderId },
        select: { payableAmount: true },
      });
      const payable = order?.payableAmount ?? 0;
      const refundable = candidate.items.reduce((s, i) => s + i.unitPrice * i.refundQty, 0);
      const ratioBp = payable > 0 ? Math.round((refundable / payable) * 10_000) : 0;
      if (ratioBp < rule.partialShortageThresholdBp) {
        logger.info({
          msg: 'OOS_REFUND_THRESHOLD_NOT_MET',
          orderId: candidate.orderId,
          ratioBp,
          thresholdBp: rule.partialShortageThresholdBp,
        });
        return { triggered: false, refundId: null, amount: 0, mode: 'none' };
      }
    }

    const refundMethod = await this.resolveRefundMethod(candidate.orderId);

    // 3-4. 合并账 + 建单/追加 + 免审上限判定 + 直退/转人工（同一事务）
    const result = await withTransaction(async (tx: Tx) => {
      // 与 refund.service (3, hash) 不重叠的两参整型对（P1-1 修复同款：hashtext 返回 int，
      // 两参重载只有 (integer,integer)，不能 ::bigint）
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4, hashtext(${candidate.orderId}))`;

      // D13 合并账：同单进行中 OUT_OF_STOCK system 退款（PENDING/APPROVED）→ 追加
      const inFlight = await tx.refund.findFirst({
        where: {
          orderId: candidate.orderId,
          reason: 'OUT_OF_STOCK',
          reviewedBy: 'SYSTEM',
          status: { in: ['PENDING', 'APPROVED'] },
        },
        include: { items: true },
      });

      if (inFlight) {
        // 追加 RefundItem 行（跳过已入账项防重复）+ 重算 amount
        const existingItemIds = new Set(inFlight.items.map((i) => i.orderItemId));
        const newLines = candidate.items.filter((i) => !existingItemIds.has(i.orderItemId));
        if (newLines.length === 0) {
          // P3-3（审查修复 20261024）：零新增（本次项全部已入账）→ 无任何变化，
          // 不推「退款处理中」（重复登记场景推送无意义），mode='pending' 仅返回
          return { refundId: inFlight.id, amount: inFlight.amount, mode: 'pending' as const, created: false, changed: false };
        }
        for (const line of newLines) {
          await tx.refundItem.create({
            data: {
              refundId: inFlight.id,
              orderItemId: line.orderItemId,
              skuId: line.skuId,
              productName: line.productName as Prisma.InputJsonValue,
              unitPrice: line.unitPrice,
              refundQty: line.refundQty,
              subtotal: line.unitPrice * line.refundQty,
            },
          });
        }
        // 重算 amount = 既有 items subtotal 和 + 新行（事务内权威重读）
        const agg = await tx.refundItem.aggregate({
          where: { refundId: inFlight.id },
          _sum: { subtotal: true },
        });
        const amount = agg._sum.subtotal ?? 0;
        await tx.refund.update({
          where: { id: inFlight.id },
          data: { amount },
        });
        return { refundId: inFlight.id, amount, mode: 'pending' as const, created: false, changed: true };
      }

      // 新建（D13 无进行中 / D14 COMPLETED 后二次缺货第二笔）
      // P3-1（审查修复 20261024）：D14 守卫豁免收窄——v3 Q5 拍板「仅 system 通路且整单全缺」。
      // 非全缺（部分缺）且已有 COMPLETED system 退款（第二笔起）→ 不再绕过共享守卫新建，
      // 返回 triggered=false 交人工（阈值规则语义不应自动叠加多笔）。
      if (!candidate.fullShortage) {
        const completedOos = await tx.refund.count({
          where: { orderId: candidate.orderId, reason: 'OUT_OF_STOCK', status: 'COMPLETED' },
        });
        if (completedOos > 0) {
          logger.info({
            msg: 'OOS_REFUND_D14_PARTIAL_SKIPPED',
            orderId: candidate.orderId,
            completedOos,
          });
          return { refundId: null, amount: 0, mode: 'none' as const, created: false };
        }
      }
      const amount = candidate.items.reduce((s, i) => s + i.unitPrice * i.refundQty, 0);
      // D17 免审上限：单笔退款单金额 ≤ 上限 → 直退；超限 → PENDING 人工
      const direct = amount <= rule.autoRefundMaxAmount;

      // 防超额兜底（通路内部守卫，不改共享 :252-263 校验）：Σ COMPLETED + 本次 ≤ payable
      const order = await tx.order.findUnique({
        where: { id: candidate.orderId },
        select: { payableAmount: true },
      });
      const completedSum = await tx.refund.aggregate({
        where: { orderId: candidate.orderId, status: 'COMPLETED' },
        _sum: { amount: true },
      });
      const refundedAlready = completedSum._sum.amount ?? 0;
      if (!order || refundedAlready + amount > order.payableAmount) {
        logger.warn({
          msg: 'OOS_REFUND_EXCEEDS_PAYABLE',
          orderId: candidate.orderId,
          refundedAlready,
          amount,
          payable: order?.payableAmount ?? -1,
        });
        return { refundId: null, amount: 0, mode: 'none' as const, created: false, changed: false };
      }

      const created = await tx.refund.create({
        data: {
          orderId: candidate.orderId,
          userId: await this.resolveOrderUserId(tx, candidate.orderId),
          amount,
          reason: 'OUT_OF_STOCK',
          status: 'PENDING',
          refundMethod,
          // reviewedBy 不在此处置 SYSTEM：direct 路径由 completeSystemRefundTx 的 flipData
          // 写入；pending 路径在下方显式 update 补 SYSTEM 标记
          reviewedBy: null,
          items: {
            create: candidate.items.map((i) => ({
              orderItemId: i.orderItemId,
              skuId: i.skuId,
              productName: i.productName as Prisma.InputJsonValue,
              unitPrice: i.unitPrice,
              refundQty: i.refundQty,
              subtotal: i.unitPrice * i.refundQty,
            })),
          },
        },
        include: { items: true },
      });

      if (!direct) {
        // 超限 → PENDING 人工（reviewedBy 置 'SYSTEM' 标记通路来源，人工 reviewRefund 可见）
        await tx.refund.update({
          where: { id: created.id },
          data: { reviewedBy: 'SYSTEM' },
        });
        return { refundId: created.id, amount, mode: 'pending' as const, created: true, changed: true };
      }

      // 直退（D9b）：reviewedBy='SYSTEM' + completeRefundTx 同款单点收口（restock 恒不传）
      const completed = await this.completeSystemRefundTx(tx, created.id, candidate.orderId);
      return { refundId: created.id, amount: completed.amount, mode: 'direct' as const, created: true, changed: true };
    });

    if (!result.refundId || !(result as { changed?: boolean }).changed) {
      // P3-3：无变化（零新增合并账）不推送——triggered 仍按有无 refundId 上报
      if (result.refundId) {
        return { triggered: true, refundId: result.refundId, amount: result.amount, mode: result.mode };
      }
      return { triggered: false, refundId: null, amount: 0, mode: 'none' };
    }

    // 5. 推送（事务外，notify 内部吞错——同批2 D16 纪律：失败不回滚退款）
    await this.notifyRefundResult(candidate.orderId, result.mode, result.amount);

    logger.info({
      msg: 'OOS_REFUND_PROCESSED',
      orderId: candidate.orderId,
      refundId: result.refundId,
      mode: result.mode,
      amount: result.amount,
    });
    return { triggered: true, refundId: result.refundId, amount: result.amount, mode: result.mode };
  }

  /**
   * system 直退事务内收口（completeRefundTx 同款语义，独立实现）
   *
   * 照抄 refund.service.ts:489 三步但独立演进（🔴 共享代码零改动）：
   *   1. 标 COMPLETED（reviewedBy='SYSTEM'）——status='PENDING' 条件翻转封并发
   *   2. 销量回滚守卫（预付 PAID / COD 有收款成功记录才回滚——DELIVERING 窗口 COD
   *      未收款自动跳过，补核①结论）
   *   3. Settlement 负向调整（同事务原子，applyRefundSettlementAdjustment 复用）
   *   不传 restock（不回补库存，D9b）
   */
  private async completeSystemRefundTx(
    tx: Tx,
    refundId: string,
    orderId: string,
  ): Promise<{ amount: number }> {
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { items: true } });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        paymentStatus: true,
        paymentMethod: true,
        warehouseId: true,
        warehouse: { select: { shopId: true } },
        items: { select: { skuId: true, quantity: true } },
      },
    });

    const transactionId = `MOCK_REFUND_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const flipData = {
      status: 'COMPLETED' as const,
      transactionId,
      completedAt: new Date(),
      reviewedBy: 'SYSTEM',
      reviewedAt: new Date(),
      reviewNote: 'SYSTEM_AUTO_REFUND_OUT_OF_STOCK',
    };
    // 条件翻转封并发（同款 P2-1 范式）：只有一笔能翻走
    const flipped = await tx.refund.updateMany({
      where: { id: refundId, status: 'PENDING' },
      data: flipData,
    });
    if (flipped.count === 0) {
      // P3-2（审查修复 20261024）：并发翻转失败≠规则禁用——语义改 E-OOS-008
      throw new ConflictException({
        code: 'E-OOS-008',
        message: `System refund ${refundId} is no longer pending (concurrent completion)`,
      });
    }

    // 销量回滚守卫（补核①：预付 paymentStatus=PAID；COD 以收款成功记录为准）
    let salesCounted = order.paymentStatus === 'PAID';
    if (!salesCounted && order.paymentMethod === 'COD') {
      const cash = await tx.cashCollection.findFirst({
        where: { orderId, result: { in: ['PAID', 'SHORT'] } },
        select: { id: true },
      });
      salesCounted = !!cash;
    }
    if (salesCounted) {
      if (refund.items.length > 0) {
        await rollbackSalesCountForRefundItems(
          tx,
          orderId,
          refund.items.map((i) => ({ skuId: i.skuId, refundQty: i.refundQty })),
          { operatorId: 'SYSTEM' },
        );
      } else {
        await rollbackSalesCountForFullOrder(tx, orderId, { operatorId: 'SYSTEM' });
      }
    }

    // Settlement 负向调整（同事务原子；restock 不传 = 不回补库存）
    await applyRefundSettlementAdjustment(
      tx,
      refund.amount,
      flipData.completedAt,
      order.warehouse.shopId,
    );

    logger.info({
      msg: 'OOS_REFUND_COMPLETED_TX',
      refundId,
      orderId,
      amount: refund.amount,
      salesCountRolledBack: salesCounted,
    });
    return { amount: refund.amount };
  }

  /**
   * 规则解析（D15）：warehouseId 精确行 → 全局行（warehouseId=null）→ 代码默认
   */
  private async resolveRule(warehouseId: string | null) {
    if (warehouseId) {
      const precise = await db.outOfStockRule.findFirst({ where: { warehouseId } });
      if (precise) return precise;
    }
    const global = await db.outOfStockRule.findFirst({ where: { warehouseId: null } });
    return global ?? DEFAULT_OOS_RULE;
  }

  /** 退款方式 = 原支付方式（PaymentIntent.method，无则 COD——对齐 refund.service :126 先例） */
  private async resolveRefundMethod(orderId: string): Promise<string> {
    const pi = await db.paymentIntent.findUnique({ where: { orderId }, select: { method: true } });
    return pi?.method ?? 'COD';
  }

  /**
   * 全局规则更新（D17：规则表为真源 + SystemConfig 镜像同事务回写）
   *
   * admin settings 页写入口（SUPER_ADMIN）；仓库精确行留后续批次（MVP 只开全局规则）。
   * 镜像 key（seed 预置 oos.* 四条）：规则行 upsert 同事务内 systemConfig.upsert 回写，
   * 读路径 SystemConfigService 有 Redis 缓存——此处直接写 DB 会留陈旧缓存，故写后 DEL
   * SystemConfig:oos.* 四键（同 system-config.service 写后失效纪律）。
   */
  async updateGlobalRule(input: {
    autoRefundFullShortage?: boolean;
    partialShortageThresholdEnabled?: boolean;
    partialShortageThresholdBp?: number | null;
    autoRefundMaxAmount?: number;
  }): Promise<void> {
    const current = await this.resolveRule(null);
    const next = {
      autoRefundFullShortage:
        input.autoRefundFullShortage ?? current.autoRefundFullShortage,
      partialShortageThresholdEnabled:
        input.partialShortageThresholdEnabled ?? current.partialShortageThresholdEnabled,
      partialShortageThresholdBp:
        input.partialShortageThresholdBp !== undefined
          ? input.partialShortageThresholdBp
          : current.partialShortageThresholdBp,
      reportTimeoutEnabled: current.reportTimeoutEnabled,
      reportTimeoutMinutes: current.reportTimeoutMinutes,
      autoRefundMaxAmount: input.autoRefundMaxAmount ?? current.autoRefundMaxAmount,
    };

    await withTransaction(async (tx: Tx) => {
      const global = await tx.outOfStockRule.findFirst({ where: { warehouseId: null } });
      if (global) {
        await tx.outOfStockRule.update({ where: { id: global.id }, data: next });
      } else {
        await tx.outOfStockRule.create({ data: { warehouseId: null, ...next } });
      }
      // 镜像回写（D17 同事务）：真源规则行落定后同步 systemConfig 副本
      const mirrors: Array<[string, string]> = [
        ['oos.auto_refund_full_shortage', String(next.autoRefundFullShortage)],
        ['oos.partial_shortage_threshold_enabled', String(next.partialShortageThresholdEnabled)],
        ['oos.partial_shortage_threshold_bp', next.partialShortageThresholdBp == null ? '' : String(next.partialShortageThresholdBp)],
        ['oos.auto_refund_max_amount', String(next.autoRefundMaxAmount)],
      ];
      for (const [key, value] of mirrors) {
        await tx.systemConfig.upsert({
          where: { key },
          update: { value },
          create: { key, value, description: 'Mirror of out_of_stock_rule global row (batch3 D17)', updatedBy: 'SYSTEM' },
        });
      }
    });

    // 镜像缓存失效（写后 DEL，同 system-config.service 纪律；失败仅告警——TTL 5min 自愈）
    try {
      const { redis } = await import('../../shared/cache');
      await redis.del(
        'SystemConfig:oos.auto_refund_full_shortage',
        'SystemConfig:oos.partial_shortage_threshold_enabled',
        'SystemConfig:oos.partial_shortage_threshold_bp',
        'SystemConfig:oos.auto_refund_max_amount',
      );
    } catch (e) {
      logger.warn({ msg: 'OOS_RULE_MIRROR_CACHE_DEL_FAILED', error: (e as Error).message });
    }

    logger.info({ msg: 'OOS_RULE_UPDATED', ...next });
  }

  private async resolveOrderUserId(tx: Tx, orderId: string): Promise<string> {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { userId: true } });
    if (!order) {
      throw new ConflictException({ code: 'E-ORDER-004', message: `Order not found: ${orderId}` });
    }
    return order.userId;
  }

  /**
   * 退款结果推送（D16 同款纪律：事务外、notify 吞错、失败仅告警）
   *
   * direct → outOfStockAutoRefunded（新模板 key，五语）；pending → outOfStockRefundPending
   * （批2 挂账顺手修：推送语言按 DeviceToken.locale 逐设备 pick 已是 notification-event
   * service 既有机制，本方法只需传 key——站内信五语全存、PUSH 按 token locale）
   */
  private async notifyRefundResult(
    orderId: string,
    mode: 'direct' | 'pending',
    amount: number,
  ): Promise<void> {
    if (!this.notificationEvents) return;
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { userId: true, orderNo: true },
      });
      if (!order?.userId) return;
      await this.notificationEvents.notify({
        event: mode === 'direct' ? 'outOfStockAutoRefunded' : 'outOfStockRefundPending',
        userId: order.userId,
        type: 'ORDER_UPDATE',
        data: { orderId, orderNo: order.orderNo, amount, mode },
        params: { orderNo: order.orderNo ?? '', amount: (amount / 100).toFixed(2) },
      });
    } catch (e) {
      logger.warn({
        msg: 'OOS_REFUND_NOTIFY_FAILED',
        orderId,
        mode,
        error: (e as Error).message,
      });
    }
  }
}
