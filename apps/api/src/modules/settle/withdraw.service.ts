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
import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
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
  // 批A A4（2026-09-09）：事件通知挂点（提现审核结果 → 站内信 + PUSH；单测传 null 兼容）
  private readonly notificationEvents: {
    notify: (input: {
      event: string;
      userId: string;
      type: string;
      data?: Record<string, unknown>;
      params?: Record<string, string>;
    }) => Promise<void>;
  } | null;

  constructor(
    @Inject('NotificationEventServiceToken')
    notificationEvents: {
      notify: (input: {
        event: string;
        userId: string;
        type: string;
        data?: Record<string, unknown>;
        params?: Record<string, string>;
      }) => Promise<void>;
    } | null,
  ) {
    this.notificationEvents = notificationEvents;
  }

  /**
   * 可用余额统一口径（方案 v2 批1 P0-B，2026-11-21）
   *
   *   available = Σ Settlement.netAmount(subjectType, subjectId, status ∈ {CONFIRMED, PAID})
   *             − Σ WithdrawalRequest.amount(requesterType, requesterId, status ∈ {PENDING, APPROVED, PAID})
   *
   * 双花根因是旧口径只扣 PAID，在途（PENDING/APPROVED）不占额度；
   * 展示（getAvailableBalance）与扣减（create/review 复核）必须走本函数单一口径。
   * tx 由调用方传入：create/review 传事务 tx，getAvailableBalance 传 db。
   */
  private async computeAvailableBalance(
    tx: Pick<typeof db, 'settlement' | 'withdrawalRequest'>,
    requesterType: string,
    requesterId: string,
  ): Promise<number> {
    const settledAgg = await tx.settlement.aggregate({
      where: {
        subjectType: requesterType,
        subjectId: requesterId,
        status: { in: ['CONFIRMED', 'PAID'] },
      },
      _sum: { netAmount: true },
    });
    const inFlightAgg = await tx.withdrawalRequest.aggregate({
      where: {
        requesterType,
        requesterId,
        status: { in: ['PENDING', 'APPROVED', 'PAID'] },
      },
      _sum: { amount: true },
    });
    return (settledAgg._sum.netAmount ?? 0) - (inFlightAgg._sum.amount ?? 0);
  }

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
      // P0-B：扣减口径纳入在途（PENDING/APPROVED/PAID），统一走 computeAvailableBalance
      const balance = await this.computeAvailableBalance(
        tx,
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

  /** 平台审核（APPROVE / REJECT） — review2-fix-3：防状态机 race */
  async review(
    id: string,
    input: WithdrawalReviewInputType,
    reviewerId: string,
  ): Promise<WithdrawalRequestType> {
    // 单线程读 + 校验状态（快速失败给清晰错误码）
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

    // review2-fix-3：把 status='PENDING' 推到 WHERE 子句
    // 两个 admin 同时点 APPROVE + REJECT 时，第二个 updateMany.count === 0 → 抛 ConflictException
    //
    // P0-B（方案v2 批1）：APPROVE 翻转前在事务内复核余额（advisory lock 与 create 同键，
    // 串行化对同一 requester 的 create/review 竞态）。不足 → 自动 REJECT 附 E-SETTLE-001
    // 语义 rejectReason，不抛错（admin 看到拒绝结果而非 500）。
    if (input.action === 'APPROVE') {
      const approved = await withTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(row.requesterType, row.requesterId)})`;
        const balance = await this.computeAvailableBalance(
          tx,
          row.requesterType,
          row.requesterId,
        );
        if (row.amount > balance) {
          // 余额不足：事务内置 REJECTED（本单自身仍是 PENDING，不占额度）。
          // review2-fix-3 同款条件翻转：where 带 status:'PENDING'，count=0 说明
          // 并发赢家（另一 admin / markPaid 链）已翻转本单 → 跳过自动 REJECT 不覆盖
          const rejected = await tx.withdrawalRequest.updateMany({
            where: { id, status: 'PENDING' },
            data: {
              status: 'REJECTED',
              rejectReason: `E-SETTLE-001: insufficient balance (available ${balance}, requested ${row.amount})`,
              reviewedBy: reviewerId,
              reviewedAt: new Date(),
            },
          });
          if (rejected.count === 0) {
            logger.warn({
              msg: 'WITHDRAWAL_AUTO_REJECT_SKIPPED_CONCURRENT_FLIP',
              id,
              amount: row.amount,
              reviewerId,
            });
            return null;
          }
          return db.withdrawalRequest.findUnique({ where: { id } });
        }
        return null;
      });
      if (approved) {
        logger.warn({
          msg: 'WITHDRAWAL_AUTO_REJECTED_INSUFFICIENT_BALANCE',
          id,
          amount: row.amount,
          reviewerId,
        });
        await this.notifyReviewed(approved);
        return this.toDto(approved);
      }
      // 余额充足 → 落到下方正常翻转（事务已提交，无副作用）
    }

    const result = await db.withdrawalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        rejectReason: input.action === 'REJECT' ? input.rejectReason : null,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        code: 'E-SETTLE-003',
        message: `Withdrawal ${id} status changed concurrently (race detected)`,
      });
    }

    // updateMany 不返回完整 row，回查
    const updated = (await db.withdrawalRequest.findUnique({ where: { id } }))!;
    logger.info({
      msg: 'WITHDRAWAL_REVIEWED',
      id,
      action: input.action,
      reviewerId,
    });

    await this.notifyReviewed(updated);

    return this.toDto(updated);
  }

  /**
   * 提现审核结果通知（批A A4 挂点 7：站内信 + PUSH，WALLET，data.withdrawId+status）
   * RIDER 类型时 requesterId（RiderProfile.id）映射回 User.id；MERCHANT 暂不通知。
   */
  private async notifyReviewed(updated: {
    id: string;
    requesterType: string;
    requesterId: string;
    status: string;
  }): Promise<void> {
    if (this.notificationEvents && updated.requesterType === 'RIDER') {
      const profile = await db.riderProfile.findUnique({
        where: { id: updated.requesterId },
        select: { userId: true },
      });
      if (profile) {
        await this.notificationEvents.notify({
          event: 'withdrawReviewed',
          userId: profile.userId,
          type: 'WALLET',
          data: { withdrawId: updated.id, status: updated.status },
          params: { withdrawId: updated.id, status: updated.status.toLowerCase() },
        });
      }
    }
  }

  /** 线下打款完成标记（super_admin 录入凭证） — review2-fix-3：防状态机 race */
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

    // review2-fix-3：把 status='APPROVED' 推到 WHERE 子句
    const result = await db.withdrawalRequest.updateMany({
      where: { id, status: 'APPROVED' },
      data: {
        status: 'PAID',
        payoutReference: input.payoutReference,
        paidAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        code: 'E-SETTLE-003',
        message: `Withdrawal ${id} status changed concurrently (race detected)`,
      });
    }

    const updated = (await db.withdrawalRequest.findUnique({ where: { id } }))!;
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

  /** 计算可用余额（P0-B 口径）= 已结算 netAmount 总和 − 在途+已 PAID 提现总和（与扣减同函数同口径） */
  async getAvailableBalance(
    requesterType: WithdrawalRequesterType,
    requesterId: string,
  ): Promise<number> {
    return this.computeAvailableBalance(db, requesterType, requesterId);
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
