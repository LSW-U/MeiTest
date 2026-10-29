/**
 * Suggestion Timeout Processor — PENDING 替换建议超时扫描（BullMQ WorkerHost）
 *
 * 替换品批1（2026-10-29 D7）：
 *   - 每 5min 扫 suggestionStatus=PENDING 且 decision window 过期（suggestionDecidedAt
 *     无值，超时基准 = 登记推送时间。D4 无独立 pendingAt 列 → 用「置 PENDING 的登记
 *     事件」不可靠，改用 OrderEvent OUT_OF_STOCK_REPORTED 里 metadata 带时间？——
 *     简化：扫 OrderItem PENDING 行 join Order，超时基准取 OrderEvent(REPLACED 类似)
 *     不存在的最近 OUT_OF_STOCK_REPORTED createdAt）
 *
 * 实现取舍（批1 最低改动）：
 *   PENDING 行无 pendingSince 列（D4 只加 2 列），超时基准用 OrderEvent
 *   eventType=OUT_OF_STOCK_REPORTED 且 metadata.itemId=itemId 的 createdAt（登记时刻）。
 *   扫描：findMany PENDING items → 逐项查登记事件 createdAt → 过期则：
 *     置 DECLINED + decidedAt → 复用 OrderService 退款链（D6 同款，走引擎候选）→ 推送
 *
 * 容错：单条失败不影响其余（逐项 try/catch 告警），单次扫描失败不影响下次。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SUGGESTION_TIMEOUT_QUEUE } from '../../shared/queue';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { OrderService } from './order.service';

export interface SuggestionTimeoutJobData {
  /** 占位（repeat job 无业务参数）；预留手动触发用 */
  dryRun?: boolean;
}

export interface SuggestionTimeoutJobResult {
  expired: number;
  dryRun: boolean;
}

/** 代码内置默认（SystemConfig key 缺失时，D11 缺 key 不依赖 seed 同款纪律） */
const DEFAULT_TIMEOUT_HOURS = 24;

/** SystemConfig key（D7，seed.ts 已预置） */
const TIMEOUT_KEY = 'oos.suggestion_timeout_hours';

@Processor(SUGGESTION_TIMEOUT_QUEUE, { concurrency: 1 })
export class SuggestionTimeoutProcessor extends WorkerHost {
  constructor(
    // DI 显式 token（tsx 无 decorator metadata；order.module 已注册 useExisting）
    @Optional() @Inject('SUGGESTION_TIMEOUT_ORDER_SERVICE')
    private readonly orderService?: OrderService | null,
  ) {
    super();
  }

  async process(job: Job<SuggestionTimeoutJobData, SuggestionTimeoutJobResult>): Promise<SuggestionTimeoutJobResult> {
    if (job.name !== 'expire-stale-suggestions') {
      logger.warn({ msg: 'suggestion_timeout_unknown_job', jobName: job.name });
      return { expired: 0, dryRun: false };
    }
    if (job.data?.dryRun === true) {
      logger.info({ msg: 'suggestion_timeout_dry_run_skip' });
      return { expired: 0, dryRun: true };
    }

    // 1. 读时限（SystemConfig value 为小时；解析失败回退默认）
    const cfg = await db.systemConfig.findUnique({ where: { key: TIMEOUT_KEY }, select: { value: true } });
    const hours = Number(cfg?.value);
    const timeoutHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TIMEOUT_HOURS;
    const deadline = new Date(Date.now() - timeoutHours * 3600_000);

    // 2. 扫 PENDING 行（join Order 过滤软删 + 非决策窗口态）
    const pendingItems = await db.orderItem.findMany({
      where: { suggestionStatus: 'PENDING' },
      select: { id: true, orderId: true, order: { select: { status: true, deletedAt: true } } },
    });
    const candidates = pendingItems.filter(
      (i) => !i.order.deletedAt && ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY'].includes(i.order.status),
    );

    let expired = 0;
    let noEventSkipped = 0; // P2-2：缺登记事件的行数（可观测，不静默）
    for (const c of candidates) {
      try {
        // 3. 超时基准 = 登记事件 createdAt（OUT_OF_STOCK_REPORTED metadata.itemId 精确匹配）。
        // P2-1 修复（2026-10-29）：where 直接按 metadata.itemId 精确找本行自己的登记事件
        // ——原实现的「探针 + 重找」重跑同一条查询恒返回同一条（死代码），且同单多行
        // PENDING 时各行都拿到最近一条事件的 createdAt（第一行的登记时间），第二行被提前超时。
        const event = await db.orderEvent.findFirst({
          where: {
            orderId: c.orderId,
            eventType: 'OUT_OF_STOCK_REPORTED',
            // Prisma Json path 过滤：metadata.itemId = 本项 id（每行各自的登记时刻）
            metadata: { path: ['itemId'], equals: c.id },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, metadata: true },
        });
        // P2-2 修复（2026-10-29）：找不到登记事件 → 告警 + 计入汇总（可观测），
        // 不再静默 continue（PENDING 永久悬挂违反单次补偿纪律可见性）。
        // 无兜底基准列（OrderItem 无 createdAt/updatedAt，D4 只加 2 列不做 migration）→
        // 只能跳过：正常链路事件与 PENDING 同事务写入不会缺，缺事件仅历史回填/手工修数行，
        // 计入 noEventSkipped 供巡检发现（绝不误杀）。
        let reportedAt = event?.createdAt ?? null;
        if (!reportedAt) {
          noEventSkipped += 1;
          logger.warn({
            msg: 'SUGGESTION_TIMEOUT_NO_REPORT_EVENT',
            itemId: c.id,
            orderId: c.orderId,
            hint: 'OUT_OF_STOCK_REPORTED event missing for pending item; skipped (no reliable pendingSince baseline)',
          });
          continue;
        }
        if (reportedAt > deadline) continue;

        // 4. 自动拒绝（D7）：置 DECLINED + 退款链 + 推送（decideSuggestion 幂等守卫兜底并发：
        //    非粗 PENDING 抛 E-OOS-011，逐项 try/catch 吞掉即可）
        await db.orderItem.update({
          where: { id: c.id },
          data: { suggestionStatus: 'DECLINED', suggestionDecidedAt: new Date() },
        });
        if (this.orderService) {
          await this.orderService.decideSuggestionTimeoutRefund(c.orderId, c.id);
        }
        expired += 1;
      } catch (e) {
        // 并发（用户决策抢先）/退款失败：告警不中断本次扫描
        logger.warn({
          msg: 'SUGGESTION_TIMEOUT_ITEM_FAILED',
          itemId: c.id,
          orderId: c.orderId,
          error: (e as Error).message,
        });
      }
    }

    logger.info({
      msg: 'suggestion_timeout_done',
      scanned: candidates.length,
      expired,
      noEventSkipped, // P2-2 可观测
      timeoutHours,
    });
    return { expired, dryRun: false };
  }
}
