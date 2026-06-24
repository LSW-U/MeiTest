/**
 * Settlement Service — 结算单生成 + 查询
 *
 * 决策依据：
 * - 决策 2026-06-24：T+1 结算频率，接口预留配置项可改周/月结
 * - W3 B 方案：mock 订单数据骨架，C 流程订单/支付完成后切真
 *
 * 切换真数据：实现 OrderAggregator 接口（注入 SETTLE_ORDER_AGGREGATOR token）
 */
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import type {
  SettlementType,
  SettlementQueryType,
  SettlementRunInputType,
  SettlementSubjectTypeType,
} from '@meimart/api-contract';

/**
 * 订单聚合数据源（C 流程完成后提供真实实现）
 *
 * MVP 阶段（W3）：MockOrderAggregator 返回固定假数据
 * W3 末：C 流程订单/支付完成后切真 RealOrderAggregator（直接查 orders 表）
 */
export interface OrderAggregator {
  /** 按周期 + 对象聚合订单数据 */
  aggregate(
    periodDate: Date,
    subjectType: SettlementSubjectTypeType,
    subjectId: string,
  ): Promise<{
    orderCount: number;
    grossAmount: number;
    refundAmount: number;
    commission: number;
  }>;
}

/** 注入 token（避免命名冲突） */
export const SETTLE_ORDER_AGGREGATOR = Symbol('SETTLE_ORDER_AGGREGATOR');

/** Mock 实现（C 流程订单未完成前用） */
@Injectable()
export class MockOrderAggregator implements OrderAggregator {
  async aggregate(
    _periodDate: Date,
    subjectType: SettlementSubjectTypeType,
    subjectId: string,
  ) {
    // 用 subjectId hash 生成稳定的假数据（同一对象每天聚合一致）
    const seed = subjectId.charCodeAt(0) + subjectId.length;
    const orderCount = 5 + (seed % 10);
    const grossAmount = orderCount * (8000 + (seed % 5000)); // 80-130 元/单
    const refundAmount = Math.floor(grossAmount * 0.03); // 3% 退款率
    const commissionRate = subjectType === 'MERCHANT' ? 0.08 : 0.0; // 商家 8% 抽成，骑手不抽
    const commission = Math.floor((grossAmount - refundAmount) * commissionRate);
    return { orderCount, grossAmount, refundAmount, commission };
  }
}

@Injectable()
export class SettlementService {
  constructor(
    @Inject(SETTLE_ORDER_AGGREGATOR) private readonly aggregator: OrderAggregator,
  ) {}

  /**
   * 生成单条结算单（T+1 定时任务循环调，或 super_admin 手动触发）
   *
   * 幂等：同一 (periodDate, subjectType, subjectId) 已存在则跳过（返回 existing）
   */
  async runSettlement(input: SettlementRunInputType): Promise<SettlementType> {
    const periodDate = input.periodDate ?? this.getYesterday();

    // 幂等检查
    const existing = await db.settlement.findFirst({
      where: {
        periodDate: new Date(periodDate),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    });
    if (existing) {
      logger.info({
        msg: 'SETTLEMENT_SKIPPED_EXISTING',
        periodDate,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      });
      return this.toDto(existing);
    }

    const agg = await this.aggregator.aggregate(
      new Date(periodDate),
      input.subjectType,
      input.subjectId,
    );
    const netAmount = agg.grossAmount - agg.commission - agg.refundAmount;

    const row = await db.settlement.create({
      data: {
        periodDate: new Date(periodDate),
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        orderCount: agg.orderCount,
        grossAmount: agg.grossAmount,
        commission: agg.commission,
        refundAmount: agg.refundAmount,
        netAmount,
        status: 'PENDING',
      },
    });

    logger.info({
      msg: 'SETTLEMENT_CREATED',
      id: row.id,
      periodDate,
      subjectType: input.subjectType,
      netAmount,
    });

    return this.toDto(row);
  }

  /** 列表查询（游标分页简化为 offset 分页） */
  async list(query: SettlementQueryType): Promise<{
    items: SettlementType[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = {
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodFrom || query.periodTo
        ? {
            periodDate: {
              gte: query.periodFrom ? new Date(query.periodFrom) : undefined,
              lte: query.periodTo ? new Date(query.periodTo) : undefined,
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.settlement.findMany({
        where,
        orderBy: { periodDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.settlement.count({ where }),
    ]);

    return {
      items: items.map(this.toDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string): Promise<SettlementType> {
    const row = await db.settlement.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        code: 'E-SETTLE-004',
        message: `Settlement not found: ${id}`,
      });
    }
    return this.toDto(row);
  }

  private getYesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  private toDto(row: {
    id: string;
    periodDate: Date;
    subjectType: string;
    subjectId: string;
    warehouseId: string | null;
    orderCount: number;
    grossAmount: number;
    commission: number;
    refundAmount: number;
    netAmount: number;
    status: string;
    confirmedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SettlementType {
    return {
      id: row.id,
      periodDate: row.periodDate.toISOString().slice(0, 10),
      subjectType: row.subjectType as SettlementSubjectTypeType,
      subjectId: row.subjectId,
      warehouseId: row.warehouseId,
      orderCount: row.orderCount,
      grossAmount: row.grossAmount,
      commission: row.commission,
      refundAmount: row.refundAmount,
      netAmount: row.netAmount,
      status: row.status as SettlementType['status'],
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
