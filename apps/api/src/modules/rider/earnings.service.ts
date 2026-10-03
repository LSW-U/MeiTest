/**
 * Rider Earnings Service — 骑手收入汇总 + 流水（批2 B-P1-2，R11 口径）
 *
 * R11 拍板（20261003）：不建新表、不加 balance 字段——
 *   availableBalance = Σ Settlement.netAmount(subjectType=RIDER, subjectId=当前骑手,
 *                       status ∈ {CONFIRMED, PAID})
 *                      − Σ WithdrawalRequest.amount(requesterType=RIDER,
 *                       requesterId=当前骑手, status=PAID)
 *   today / weekly / monthly：同源 Settlement.netAmount 按 periodDate 滚动窗口
 *   （今日 / 近 7 天 / 近 30 天，仅计 CONFIRMED + PAID）。
 *
 * T+1 口径：当日完成的订单次日 02:00 Asia/Dili 才由 SettleScheduler 生成结算单，
 * 因此 today 字段当日恒为 0（或昨日结算值），响应注释与 openapi description 均已明示。
 *
 * 口径排除（任务书要求单测覆盖）：
 *   - Settlement DISPUTED / PENDING：不计入任何字段
 *   - WithdrawalRequest REJECTED / FAILED / PENDING / APPROVED：不扣减余额
 *
 * ID 维度：Settlement.subjectId 与 WithdrawalRequest.requesterId（RIDER 类型）均为
 * RiderProfile.id 维度（见 withdraw.service.ts RIDER 通知映射先例），本 service 入参是
 * user.sub（User.id），先查 riderProfile 再用 profile.id 聚合——与既有数据保持一致。
 */
import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { db } from '../../shared/db';
import { MARKET_TIMEZONE, getDaysAgoInTz } from '../../shared/datetime';
import type {
  RiderEarningsSummaryType,
  RiderEarningsTransactionType,
  RiderEarningsTransactionsQueryType,
  RiderWithdrawalCreateInputType,
  WithdrawalRequestType,
} from '@meimart/api-contract';
import { WithdrawalService } from '../settle/withdraw.service';

@Injectable()
export class RiderEarningsService {
  constructor(
    // 复用 admin 侧 WithdrawalService（状态机 + advisory lock 防 TOCTOU + 余额校验口径同源）
    @Inject(WithdrawalService) private readonly withdraw: WithdrawalService,
  ) {}

  /** 按 user.sub 定位 RiderProfile（service 惯例同 deposit.service.ts:108） */
  private async resolveProfileId(userSub: string): Promise<string> {
    const profile = await db.riderProfile.findUnique({ where: { userId: userSub } });
    if (!profile) {
      // RIDER role JWT 但无 profile：视为越权/数据异常，403
      throw new ForbiddenException({
        code: 'E-RIDER-001',
        message: `Rider profile not found for user: ${userSub}`,
      });
    }
    return profile.id;
  }

  /** Dili 当地 YYYY-MM-DD 的 N 天前（0 = 今天） */
  private diliDateN(daysAgo: number): Date {
    return new Date(`${getDaysAgoInTz(daysAgo, MARKET_TIMEZONE)}T00:00:00.000Z`);
  }

  /** 滚动窗口结算收入（分）：periodDate ∈ [N 天前, 今天]，仅 CONFIRMED+PAID */
  private async windowNet(profileId: string, daysAgo: number): Promise<number> {
    const agg = await db.settlement.aggregate({
      where: {
        subjectType: 'RIDER',
        subjectId: profileId,
        status: { in: ['CONFIRMED', 'PAID'] },
        periodDate: { gte: this.diliDateN(daysAgo), lte: this.diliDateN(0) },
      },
      _sum: { netAmount: true },
    });
    return agg._sum.netAmount ?? 0;
  }

  /**
   * 收入汇总（R11 派生口径，金额均为分）
   *
   * today=当日（T+1 未结算记 0）/ weekly=近 7 天 / monthly=近 30 天（均含今日）。
   * DISPUTED/PENDING 结算单不计入；REJECTED/FAILED/PENDING/APPROVED 提现不扣减。
   */
  async getSummary(userSub: string): Promise<RiderEarningsSummaryType> {
    const profileId = await this.resolveProfileId(userSub);

    const [settledAgg, paidAgg, today, weekly, monthly] = await Promise.all([
      db.settlement.aggregate({
        where: {
          subjectType: 'RIDER',
          subjectId: profileId,
          status: { in: ['CONFIRMED', 'PAID'] },
        },
        _sum: { netAmount: true },
      }),
      db.withdrawalRequest.aggregate({
        where: { requesterType: 'RIDER', requesterId: profileId, status: 'PAID' },
        _sum: { amount: true },
      }),
      this.windowNet(profileId, 0),
      this.windowNet(profileId, 6),
      this.windowNet(profileId, 29),
    ]);

    return {
      availableBalance:
        (settledAgg._sum.netAmount ?? 0) - (paidAgg._sum.amount ?? 0),
      today,
      weekly,
      monthly,
    };
  }

  /**
   * 收入流水：Settlement(RIDER) 按 periodDate 倒序 offset 分页。
   * Settlement 表无 orderId 字段（按日聚合粒度），订单级关联不可得——
   * 前端按 periodDate + orderCount 展示（任务书「orderId 关联如可得」：不可得，注释留档）。
   * DISPUTED 行也会返回，前端展示时须标注"争议中，未计入余额"。
   */
  async getTransactions(
    userSub: string,
    query: RiderEarningsTransactionsQueryType,
  ): Promise<{
    items: RiderEarningsTransactionType[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const profileId = await this.resolveProfileId(userSub);
    const where = { subjectType: 'RIDER', subjectId: profileId };

    const [rows, total] = await Promise.all([
      db.settlement.findMany({
        where,
        orderBy: { periodDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.settlement.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        periodDate: r.periodDate.toISOString().slice(0, 10),
        orderCount: r.orderCount,
        grossAmount: r.grossAmount,
        commission: r.commission,
        refundAmount: r.refundAmount,
        netAmount: r.netAmount,
        status: r.status,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        paidAt: r.paidAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 骑手发起提现：强制 requesterType='RIDER' + requesterId=profile.id（服务端解析，
   * 不收请求体——伪造 requesterId 在类型与实现两层都不可能）。
   * 复用 admin 侧 create（advisory lock + 事务内重算余额，E-SETTLE-001 余额不足）。
   */
  async createWithdrawal(
    userSub: string,
    input: RiderWithdrawalCreateInputType,
  ): Promise<WithdrawalRequestType> {
    const profileId = await this.resolveProfileId(userSub);
    return this.withdraw.create(
      { requesterType: 'RIDER', requesterId: profileId, ...input },
      userSub,
    );
  }

  /** 骑手提现记录（仅本人，createdAt 倒序 offset 分页，只读不可改状态） */
  async listWithdrawals(
    userSub: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: WithdrawalRequestType[]; total: number; page: number; pageSize: number }> {
    const profileId = await this.resolveProfileId(userSub);
    return this.withdraw.list({
      requesterType: 'RIDER',
      requesterId: profileId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
