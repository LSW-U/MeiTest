/**
 * RealOrderAggregator — 真实订单聚合器（P0-1，方案v2-后端资金越权并发修复 20261011 批2）
 *
 * 替换 MockOrderAggregator（settle.module SETTLE_ORDER_AGGREGATOR useClass 切换），
 * 对齐 OrderAggregator 接口（settlement.service.ts:27-37）4 字段：
 *   orderCount / grossAmount / refundAmount / commission
 *
 * 聚合口径（本实现拍板，审查注意点）：
 *   周期窗口：periodDate（YYYY-MM-DD，Dili 当地日）当日 00:00 ~ 次日 00:00（Asia/Dili UTC+9，
 *   无 DST，固定 +09:00 偏移换算 UTC 窗口）。
 *
 *   MERCHANT（subjectId = shopId，经 Order.warehouseId → Warehouse.shopId 归属）：
 *     - 计入订单：createdAt 落窗口内 且 status ∉ {PENDING_PAYMENT, CANCELLED}
 *       （PENDING_PAYMENT 从未支付、随时可静默过期，计入会虚增；
 *         CANCELLED 已全额释放，不可计收）
 *     - grossAmount = Σ OrderItem.subtotal（订单明细实算，任务书口径；不含 deliveryFee——
 *       配送费是骑手收入口径（order-history Q2 拍板），不属商家货款）
 *     - refundAmount = 上述订单中 Refund.status=COMPLETED 的 amount 合计
 *     - commission = floor((grossAmount − refundAmount) × 8%)（沿 MockOrderAggregator 先例费率）
 *
 *   RIDER（subjectId = RiderProfile.id，与 Settlement/earnings 现链维度一致——
 *   withdraw.service getAvailableBalance / earnings R11 均按 RiderProfile.id 聚合）：
 *     - 计入任务：DeliveryTask.taskType='delivery' 且 riderId=subjectId 且 status='DELIVERED'
 *       且 deliveredAt 落窗口内，且关联订单未 CANCELLED（R12 互斥口径：取消只计 cancelled）
 *     - grossAmount = Σ order.deliveryFee（Q2 拍板「配送费收入」，order-history.service.ts:16 同源）
 *     - refundAmount = 0（配送费不随商品退款冲减；商品退款走 MERCHANT 结算）
 *     - commission = 0（骑手不抽成，Mock 先例）
 *
 *   与 Settlement/earnings 语义核对（A2.1 / 方案 R1）：netAmount = gross − commission − refund
 *   由 SettlementService 统一计算，MERCHANT 净额=货款−抽成−退款、RIDER 净额=配送费，
 *   availableBalance 派生链无口径冲突 → 不触发上报①。
 */
import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { MARKET_TIMEZONE } from '../../shared/datetime';
import type { SettlementSubjectTypeType } from '@meimart/api-contract';
import type { OrderAggregator } from './settlement.service';

/** MERCHANT 抽成费率（沿 MockOrderAggregator 先例 8%） */
export const MERCHANT_COMMISSION_RATE = 0.08;

/** 计入商家结算的订单状态（排除未支付与已取消） */
const MERCHANT_COUNTED_STATUSES = [
  'PENDING_CONFIRM',
  'CONFIRMED',
  'PICKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERED_PAID',
  // DELIVERED_UNPAID（COD 拒付单）计入并照抽 8%：P3-5 拍板（审查 20261012）——
  // 货已送达、商家履约完成，拒付属骑手收款环节坏账（走 COD 台账对账追偿），
  // 不冲商家货款口径
  'DELIVERED_UNPAID',
  'COMPLETED',
] as const;

@Injectable()
export class RealOrderAggregator implements OrderAggregator {
  async aggregate(
    periodDate: Date,
    subjectType: SettlementSubjectTypeType,
    subjectId: string,
  ): Promise<{
    orderCount: number;
    grossAmount: number;
    refundAmount: number;
    commission: number;
  }> {
    // periodDate 由 SettlementService 传入（new Date('YYYY-MM-DD') = UTC 零点）；
    // 取日期字符串重建 Dili 当地日窗口（防调用方传带时刻的 Date 漂移）
    const dateStr = periodDate.toISOString().slice(0, 10);
    const windowStart = new Date(`${dateStr}T00:00:00+09:00`);
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

    if (subjectType === 'MERCHANT') {
      return this.aggregateMerchant(windowStart, windowEnd, subjectId);
    }
    return this.aggregateRider(windowStart, windowEnd, subjectId);
  }

  /** 商家聚合：货款按订单明细实算，退款冲减，8% 抽成 */
  private async aggregateMerchant(windowStart: Date, windowEnd: Date, shopId: string) {
    // 经 warehouse.shopId 归属到商家（MVP 单商家，但保留按 shop 过滤的通用性）
    const orders = await db.order.findMany({
      where: {
        createdAt: { gte: windowStart, lt: windowEnd },
        status: { in: [...MERCHANT_COUNTED_STATUSES] },
        warehouse: { shopId },
        // P27 批B1：客户端软删订单不计入结算口径（结算语义与删除语义正交——软删不回退已生成 Settlement，
        // 仅聚合窗口内新订单排除软删行，与通知 readCount 不过滤的批次统计语义决策一致）
        deletedAt: null,
      },
      select: {
        id: true,
        items: { select: { subtotal: true } },
      },
    });

    // grossAmount = Σ 订单明细 subtotal（任务书口径：order_items 实算）
    let grossAmount = 0;
    for (const order of orders) {
      for (const item of order.items) {
        grossAmount += item.subtotal;
      }
    }

    // 退款：本批订单的 COMPLETED 退款合计
    const refundAgg = await db.refund.aggregate({
      where: {
        orderId: { in: orders.map((o) => o.id) },
        status: 'COMPLETED',
      },
      _sum: { amount: true },
    });
    const refundAmount = refundAgg._sum.amount ?? 0;

    const commission = Math.floor((grossAmount - refundAmount) * MERCHANT_COMMISSION_RATE);

    return { orderCount: orders.length, grossAmount, refundAmount, commission };
  }

  /** 骑手聚合：配送费收入（Q2 拍板），不抽成、不冲减退款 */
  private async aggregateRider(windowStart: Date, windowEnd: Date, riderProfileId: string) {
    const tasks = await db.deliveryTask.findMany({
      where: {
        riderId: riderProfileId,
        taskType: 'delivery',
        status: 'DELIVERED',
        deliveredAt: { gte: windowStart, lt: windowEnd },
        order: { status: { not: 'CANCELLED' }, deletedAt: null }, // P27 批B1：软删订单不计入骑手配送费聚合
      },
      select: { order: { select: { deliveryFee: true } } },
    });

    const grossAmount = tasks.reduce((sum, t) => sum + (t.order?.deliveryFee ?? 0), 0);

    return { orderCount: tasks.length, grossAmount, refundAmount: 0, commission: 0 };
  }
}

/**
 * D8（方案v3 20261012 裁定）：退款负向调整 Settlement —— P2-1 修复
 *
 * 背景：runSettlement 只在生成时聚合一次，之后订单的退款（COMPLETED 时间晚于
 * 生成时点的）永远不会反映进 Settlement → 商家可用余额虚高（P2-1）。
 *
 * 口径：
 *   - 归属期：按退款 completedAt（退款时间）落**当前** Dili 结算期间；
 *     **不改写历史已生成 Settlement**（append-only 调整）
 *   - 形态：复用 Settlement 行语义，零 migration。目标期行存在且 PENDING → 单语句原子冲减
 *     （refundAmount increment + raw SQL GREATEST clamp commission ≥ 0，netAmount 与 clamp
 *     值严格一致）；目标期不存在或已 CONFIRMED/PAID → 新建负向调整 append 行
 *     （orderCount=0、grossAmount=0、refundAmount=退款额、commission=0、netAmount=−refund，
 *     P2-2 修复：已确认期间只 append 不改写）
 *   - Σ netAmount 自洽：getAvailableBalance（withdraw.service）Σ Settlement.netAmount
 *     （CONFIRMED/PAID）− Σ PAID withdrawals，负向行的负 netAmount / 当期行的冲减
 *     都会真实降低商家可用余额
 *   - 已确认期间（P2-2）：目标期行已 CONFIRMED/PAID → 降级尝试新建负向调整 append 行
 *     （netAmount=−refund，不改写已生成行）；语义扩展调度已裁定接受。**但零 migration 下
 *     @@unique([periodDate, subjectType, subjectId]) 使 append 与已确认行不能共存** ——
 *     append 撞 P2002 → fail-closed 上抛 E-SETTLE-005 回滚退款事务，人工介入。
 *     （可达性评估：正常 T+1 排程下 completedAt 恒落「今天」，今天行在 T+1 跑批前
 *     不可能 CONFIRMED → 降级冲减路径正常可达；E-SETTLE-005 仅手工补跑历史期间/
 *     当日确认等运营动作可达，见实现注释）
 *   - 并发：P2-1 后冲减是单语句原子（updateMany increment + $executeRaw GREATEST clamp，
 *     无两步回读竞态）；append 行与 runSettlement 创建当期行竞态时由
 *     @@unique([periodDate, subjectType, subjectId]) P2002 兜底（回查 status 分流：
 *     PENDING → 降级冲减，非 PENDING → fail-closed E-SETTLE-005）
 *
 * @param tx 调用方事务句柄（completeRefundTx 传入 Prisma tx，保证退款与调整原子）
 */
export async function applyRefundSettlementAdjustment(
  tx: Prisma.TransactionClient | typeof db,
  refundAmount: number,
  refundCompletedAt: Date,
  shopId: string,
): Promise<void> {
  // 退款时间 → Dili 当地日期字符串（当期 periodDate；new Date('YYYY-MM-DD')=UTC 零点，
  // 与 SettlementService.getYesterday / RealOrderAggregator 窗口端点语义一致）
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(refundCompletedAt);
  const periodDate = new Date(`${dateStr}T00:00:00.000Z`);
  // 本笔退款对应的抽成冲减额（与聚合路径 commission = floor(base × 8%) 同费率）
  const commissionDelta = Math.floor(refundAmount * MERCHANT_COMMISSION_RATE);

  // 当期行已存在且 PENDING → 原子冲减（P2-2：where 限定 status='PENDING'——
  // 已 CONFIRMED/PAID 的历史/已确认行不可冲减，违背 D8「不改写历史已生成 Settlement」；
  // 非 PENDING 命中 0 行 → 降级走下方 append 负向调整行路径）
  // P2-1：clamp 收口单语句——commission 与 netAmount 的调整收进同一条 raw SQL：
  //   commission = GREATEST(0, commission − delta)（一步钳到 ≥0）
  //   netAmount = netAmount − (commission − 新commission) − refund
  //     其中 (commission − 新commission) = 实际抽成冲减额（clamp 截断时 = 原 commission）
  // 同语句内旧值自洽计算，netAmount 调整量与实际 clamp 值严格一致（恒等式保持），
  // 消灭「先 decrement 后回读校正」两步竞态窗口
  const adjusted = await tx.settlement.updateMany({
    where: { periodDate, subjectType: 'MERCHANT', subjectId: shopId, status: 'PENDING' },
    data: {
      refundAmount: { increment: refundAmount },
    },
  });
  if (adjusted.count > 0) {
    await tx.$executeRaw`
      UPDATE "settlements"
      SET "commission" = GREATEST(0, "commission" - ${commissionDelta}::int),
          "net_amount" = "net_amount"
            - ("commission" - GREATEST(0, "commission" - ${commissionDelta}::int))
            - ${refundAmount}::int
      WHERE "period_date" = ${periodDate} AND "subject_type" = 'MERCHANT' AND "subject_id" = ${shopId}
        AND "status" = 'PENDING'
    `;
    logger.info({
      msg: 'REFUND_SETTLEMENT_ADJUSTED',
      periodDate: dateStr,
      shopId,
      refundAmount,
      commissionDelta,
    });
    return;
  }

  // 目标期不存在（或存在但非 PENDING——已确认/历史期间，P2-2 降级）→ 新建负向调整行：
  // 该期无正收入可冲，clamp ≥ 0 → commission=0，netAmount = gross(0) − commission(0) − refund
  // = −refundAmount；append 行不触碰已生成行，Σ netAmount 依然真实降低可用余额
  // （「已确认期间允许 append 冲减」语义扩展：调度已裁定接受，审查报告 P2-2 备注在案。
  //  注意：目标期已有 CONFIRMED/PAID 行时 append 会撞 @@unique → 走 catch 的 fail-closed
  //  E-SETTLE-005（见下）；append 成功仅当目标期真无任何行，或与 runSettlement 竞态窗口内）
  try {
    await tx.settlement.create({
      data: {
        periodDate,
        subjectType: 'MERCHANT',
        subjectId: shopId,
        orderCount: 0,
        grossAmount: 0,
        commission: 0,
        refundAmount,
        netAmount: -refundAmount,
        status: 'PENDING',
      },
    });
    logger.info({
      msg: 'REFUND_SETTLEMENT_ADJUSTMENT_ROW_CREATED',
      periodDate: dateStr,
      shopId,
      refundAmount,
      // P2-2 可观测：区分「当期无行」与「目标期非 PENDING 降级 append」两种落行原因
      degradedAppend: true,
    });
  } catch (err) {
    // 与 runSettlement / 并发退款竞态：目标期行刚被创建 → P2002。
    // 回查区分两种情况：
    //   a) 行是 PENDING（正常竞态：runSettlement / 并发退款刚建行）→ 降级走冲减路径
    //   b) 行已 CONFIRMED/PAID（P2-2 降级 append 与 @@unique([periodDate, subjectType,
    //      subjectId]) 约束冲突——已确认行占住唯一键，append 同期行必撞 P2002，
    //      零 migration 下既不能冲减（P2-2 禁止）也不能 append）→ fail-closed 上抛，
    //      退款事务整体回滚，人工介入（该场景 T+1 正常排程下不可达：completedAt
    //      恒落今日期，今日行在 T+1 跑批前不可能 CONFIRMED；仅手工补跑/当日确认可达）
    if ((err as { code?: string })?.code === 'P2002') {
      const existing = await tx.settlement.findUnique({
        where: {
          periodDate_subjectType_subjectId: { periodDate, subjectType: 'MERCHANT', subjectId: shopId },
        },
      });
      if (existing?.status === 'PENDING') {
        logger.info({
          msg: 'REFUND_SETTLEMENT_ADJUSTMENT_RACE',
          periodDate: dateStr,
          shopId,
        });
        await applyRefundSettlementAdjustment(tx, refundAmount, refundCompletedAt, shopId);
        return;
      }
      logger.error({
        msg: 'REFUND_SETTLEMENT_ADJUSTMENT_BLOCKED',
        periodDate: dateStr,
        shopId,
        existingStatus: existing?.status ?? null,
        refundAmount,
      });
      throw new ConflictException({
        code: 'E-SETTLE-005',
        message: `Refund settlement adjustment blocked: period ${dateStr} row is ${existing?.status ?? 'missing'} (confirmed rows are immutable; append row conflicts with unique constraint)`,
      });
    }
    throw err;
  }
}
