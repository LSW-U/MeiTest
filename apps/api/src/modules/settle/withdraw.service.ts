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
import { db, withTransaction } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import type {
  WithdrawalRequestType,
  WithdrawalCreateInputType,
  WithdrawalReviewInputType,
  WithdrawalMarkPaidInputType,
  WithdrawalQueryType,
  WithdrawalRequesterType,
} from '@meimart/api-contract';

/**
 * 把 requesterType + requesterId 映射成 PostgreSQL advisory lock 的 int64 key
 *
 * 审查报告 P0 #4 修复：用 pg_advisory_xact_lock 在 (requester) 维度串行化
 * 余额读 + create 两步，避免并发 TOCTOU
 */
function advisoryLockKey(requesterType: string, requesterId: string): bigint {
  // 简单稳定 hash：requesterType 占高 8 位（区分 MERCHANT/RIDER）+ requesterId 哈希占低 56 位
  const typePart = BigInt(requesterType === 'MERCHANT' ? 1 : 2);
  let idHash = 0n;
  for (let i = 0; i < requesterId.length; i += 1) {
    idHash = (idHash * 131n + BigInt(requesterId.charCodeAt(i))) & 0x00ffffffffffffffn;
  }
  return (typePart << 56n) | idHash;
}

@Injectable()
export class WithdrawalService {
  /**
   * 创建提现申请（审查报告 P0 #4 修复：用 advisory lock + 事务防 TOCTOU）
   *
   * 流程：
   *   1. BEGIN
   *   2. pg_advisory_xact_lock(key)  ← 串行化同一 requester 的并发请求
   *   3. 重新计算 balance（事务内）
   *   4. 校验 amount <= balance
   *   5. INSERT withdrawal_request
   *   6. COMMIT
   */
  async create(
    input: WithdrawalCreateInputType,
    userId: string,
  ): Promise<WithdrawalRequestType> {
    const lockKey = advisoryLockKey(input.requesterType, input.requesterId);

    const row = await withTransaction(async (tx) => {
      // PostgreSQL advisory lock（事务级，COMMIT/ROLLBACK 自动释放）
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      // 事务内重算 balance（其他并发 create 被锁阻塞，此处读到的是最新值）
      const settledAgg = await tx.settlement.aggregate({
        where: {
          subjectType: input.requesterType,
          subjectId: input.requesterId,
          status: { in: ['CONFIRMED', 'PAID'] },
        },
        _sum: { netAmount: true },
      });
      const paidAgg = await tx.withdrawalRequest.aggregate({
        where: {
          requesterType: input.requesterType,
          requesterId: input.requesterId,
          status: 'PAID',
        },
        _sum: { amount: true },
      });
      const balance =
        (settledAgg._sum.netAmount ?? 0) - (paidAgg._sum.amount ?? 0);

      if (input.amount > balance) {
        throw new BadRequestException({
          code: 'E-SETTLE-001',
          message: `Withdrawal amount ${input.amount} exceeds available balance ${balance}`,
          details: { requested: input.amount, available: balance },
        });
      }

      return tx.withdrawalRequest.create({
        data: {
          requesterType: input.requesterType,
          requesterId: input.requesterId,
          amount: input.amount,
          status: 'PENDING',
          payoutAccount: input.payoutAccount as object,
        },
      });
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
