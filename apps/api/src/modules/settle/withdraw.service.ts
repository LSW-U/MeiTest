/**
 * Withdrawal Service — 提现申请 + 审核 + 线下打款记录
 *
 * 状态机：
 *   PENDING → APPROVED → PAID（正常流程）
 *   PENDING → REJECTED（拒绝）
 *   APPROVED → FAILED（线下打款失败，需重新申请）
 *
 * MVP 简化：不接真实支付平台（无主体），全部走线下打款 + 凭证录入
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import type {
  WithdrawalRequestType,
  WithdrawalCreateInputType,
  WithdrawalReviewInputType,
  WithdrawalMarkPaidInputType,
  WithdrawalQueryType,
  WithdrawalRequesterType,
} from '@meimart/api-contract';

@Injectable()
export class WithdrawalService {
  /** 创建提现申请（金额校验：不超过应结净额） */
  async create(
    input: WithdrawalCreateInputType,
    userId: string,
  ): Promise<WithdrawalRequestType> {
    // 计算应结余额（已生成结算单的 netAmount 总和 - 已 PAID 提现总和）
    const balance = await this.getAvailableBalance(
      input.requesterType,
      input.requesterId,
    );

    if (input.amount > balance) {
      throw new BadRequestException({
        code: 'E-SETTLE-001',
        message: `Withdrawal amount ${input.amount} exceeds available balance ${balance}`,
        details: { requested: input.amount, available: balance },
      });
    }

    const row = await db.withdrawalRequest.create({
      data: {
        requesterType: input.requesterType,
        requesterId: input.requesterId,
        amount: input.amount,
        status: 'PENDING',
        payoutAccount: input.payoutAccount as object,
      },
    });

    logger.info({
      msg: 'WITHDRAWAL_CREATED',
      id: row.id,
      requesterType: input.requesterType,
      requesterId: input.requesterId,
      amount: input.amount,
      userId,
    });

    return this.toDto(row);
  }

  /** 平台审核（APPROVE / REJECT） */
  async review(
    id: string,
    input: WithdrawalReviewInputType,
    reviewerId: string,
  ): Promise<WithdrawalRequestType> {
    const row = await db.withdrawalRequest.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        code: 'E-SETTLE-002',
        message: `Withdrawal request not found: ${id}`,
      });
    }
    if (row.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'E-SETTLE-003',
        message: `Withdrawal status ${row.status} cannot be reviewed (must be PENDING)`,
      });
    }

    const updated = await db.withdrawalRequest.update({
      where: { id },
      data: {
        status: input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        rejectReason: input.action === 'REJECT' ? input.rejectReason : null,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    logger.info({
      msg: 'WITHDRAWAL_REVIEWED',
      id,
      action: input.action,
      reviewerId,
    });

    return this.toDto(updated);
  }

  /** 线下打款完成标记（super_admin 录入凭证） */
  async markPaid(
    id: string,
    input: WithdrawalMarkPaidInputType,
    reviewerId: string,
  ): Promise<WithdrawalRequestType> {
    const row = await db.withdrawalRequest.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        code: 'E-SETTLE-002',
        message: `Withdrawal request not found: ${id}`,
      });
    }
    if (row.status !== 'APPROVED') {
      throw new BadRequestException({
        code: 'E-SETTLE-003',
        message: `Withdrawal status ${row.status} cannot be marked paid (must be APPROVED)`,
      });
    }

    const updated = await db.withdrawalRequest.update({
      where: { id },
      data: {
        status: 'PAID',
        payoutReference: input.payoutReference,
        paidAt: new Date(),
      },
    });

    logger.info({
      msg: 'WITHDRAWAL_PAID',
      id,
      payoutReference: input.payoutReference,
      reviewerId,
    });

    return this.toDto(updated);
  }

  /** 列表查询 */
  async list(query: WithdrawalQueryType): Promise<{
    items: WithdrawalRequestType[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = {
      ...(query.requesterType ? { requesterType: query.requesterType } : {}),
      ...(query.requesterId ? { requesterId: query.requesterId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await Promise.all([
      db.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.withdrawalRequest.count({ where }),
    ]);

    return {
      items: items.map(this.toDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string): Promise<WithdrawalRequestType> {
    const row = await db.withdrawalRequest.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        code: 'E-SETTLE-002',
        message: `Withdrawal request not found: ${id}`,
      });
    }
    return this.toDto(row);
  }

  /** 计算可用余额 = 已生成结算单 netAmount 总和 - 已 PAID 提现总和 */
  async getAvailableBalance(
    requesterType: WithdrawalRequesterType,
    requesterId: string,
  ): Promise<number> {
    const settledAgg = await db.settlement.aggregate({
      where: {
        subjectType: requesterType,
        subjectId: requesterId,
        status: { in: ['CONFIRMED', 'PAID'] },
      },
      _sum: { netAmount: true },
    });

    const paidAgg = await db.withdrawalRequest.aggregate({
      where: {
        requesterType,
        requesterId,
        status: 'PAID',
      },
      _sum: { amount: true },
    });

    return (settledAgg._sum.netAmount ?? 0) - (paidAgg._sum.amount ?? 0);
  }

  private toDto(row: {
    id: string;
    requesterType: string;
    requesterId: string;
    amount: number;
    status: string;
    payoutAccount: unknown;
    rejectReason: string | null;
    payoutReference: string | null;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WithdrawalRequestType {
    return {
      id: row.id,
      requesterType: row.requesterType as WithdrawalRequesterType,
      requesterId: row.requesterId,
      amount: row.amount,
      status: row.status as WithdrawalRequestType['status'],
      payoutAccount: row.payoutAccount as WithdrawalRequestType['payoutAccount'],
      rejectReason: row.rejectReason,
      payoutReference: row.payoutReference,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
