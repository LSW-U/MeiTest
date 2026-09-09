/**
 * Receipts Sweep Service — 回执处置 + 批次聚合（批N4，2026-09-10）
 *
 * 输入：一次 sweep job 携带的 ticketIds + getReceipts 拉回的映射。
 * 处置（任务书 N4 #3）：
 *   - receipt.status === 'ok'                          → 该 ticket 计 delivered 校准
 *   - details.error ∈ {DeviceNotRegistered, NotRegistered}
 *                                                      → token 置 INVALID（复用批A
 *                                                        EXPO_INVALID_TOKEN_ERRORS 集合）+ 计 failed
 *   - 其他 error                                       → 计 failed（保留 message 摘要日志）
 *
 * 计数口径（任务书 N4 前置 + 审查 P3-1 不回退）：deliveredCount 基数 = 站内信落行数
 * （processor 已写），回执只做**校准**：
 *   - failedCount：只增不降（increment），记录推送通道实测失败数
 *   - deliveredCount：不因回执减少（P3-1 口径不回退）；ok 回执与既有 delivered 的差额
 *     不反向回填（差额只可能来自「PUSH 失败但站内信已落」的用户，其站内信已计 delivered）
 *
 * 幂等（任务书 N4 #3）：Redis 标记 per batchId+ticketId（'1' = 已处置），重复 job /
 * BullMQ 重试时跳过已处理 ticket，防重复计数。TTL 7 天（覆盖重试窗口，过期后
 * ticket 早被 Expo 清理，重复查询也无意义）。
 */
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { EXPO_INVALID_TOKEN_ERRORS } from '../../infrastructure/notify/push.strategy';
import type { ExpoPushReceipt } from './expo-receipts';

/** 幂等标记 TTL：7 天（秒） */
const RECEIPT_PROCESSED_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 幂等标记 key 前缀 */
const RECEIPT_PROCESSED_PREFIX = 'notification:receipt:processed';

/** 处置汇总（供日志与单测断言） */
export interface ReceiptsSweepSummary {
  deliveredOk: number;
  failedInvalidToken: number;
  failedOther: number;
  skippedProcessed: number;
  /** getReceipts 未返回的 ticket 数（不标已处理，BullMQ 重试可再查） */
  missing: number;
}

/**
 * 处置一批回执并增量聚合到 NotificationBatch
 *
 * 幂等三层：
 *   1. ticket 级：Redis SETNX 已处理标记（重复 job 跳过）
 *   2. token 级：updateMany where userId+token+ACTIVE（已 INVALID 不重复写）
 *   3. 计数级：increment 只增不降（并发 sweep 不覆盖）
 *
 * Redis 异常语义（审查 P3-1 修正）：SETNX **抛异常**时视为「未标记成功」——
 * 为避免 Redis 故障期间整个 sweep 静默失效（全部误判 skipped），异常路径**
 * 继续处置**（宁可极端并发下重复 increment，也不丢校准；increment 只增语义
 * 使重复处置的代价是多计一次 failed，方向仍安全且需 Redis 同时故障+并发
 * 重试两个条件叠加）。SETNX 正常返回 null（key 已存在）才是「已处理，跳过」。
 */
export async function processReceipts(
  batchId: string,
  ticketIds: string[],
  receipts: Map<string, ExpoPushReceipt>,
): Promise<ReceiptsSweepSummary> {
  const summary: ReceiptsSweepSummary = {
    deliveredOk: 0,
    failedInvalidToken: 0,
    failedOther: 0,
    skippedProcessed: 0,
    missing: 0,
  };

  // failed 增量（invalid + other 合并 increment，一次 DB 往返）
  let failedDelta = 0;

  for (const ticketId of ticketIds) {
    // 幂等层 1：已处置 ticket 跳过（重复 job / 重试）
    let newlyMarked: string | null = null;
    let markErrored = false;
    try {
      newlyMarked = await redis.set(
        `${RECEIPT_PROCESSED_PREFIX}:${batchId}:${ticketId}`,
        '1',
        'EX',
        RECEIPT_PROCESSED_TTL_SECONDS,
        'NX',
      );
    } catch (e) {
      // 审查 P3-1：异常 ≠ 已处理。继续处置（方向安全：increment 只增，极端
      // 并发重复处置代价是多计一次 failed），并记 error 级日志暴露 Redis 故障
      markErrored = true;
      logger.error({
        msg: 'RECEIPTS_IDEMPOTENCY_MARK_FAILED',
        batchId,
        ticketId,
        error: (e as Error).message,
      });
    }
    // SETNX 正常返回 null = key 已存在 = 已处理过 → 跳过
    if (!markErrored && newlyMarked === null) {
      summary.skippedProcessed += 1;
      continue;
    }

    const receipt = receipts.get(ticketId);
    if (!receipt) {
      // Expo 未返回该 ticket（可能仍在处理）：回滚本次标记，BullMQ 重试可重查
      summary.missing += 1;
      try {
        await redis.del(`${RECEIPT_PROCESSED_PREFIX}:${batchId}:${ticketId}`);
      } catch {
        // 删除失败可接受：该 ticket 视为已处理，少一次重查（对计数无影响）
      }
      continue;
    }

    if (receipt.status === 'ok') {
      // ok：delivered 口径基数是站内信落行数（P3-1 不回退），这里只记录校准观测
      summary.deliveredOk += 1;
      continue;
    }

    // error 分支
    const errCode = receipt.details?.error ?? 'UNKNOWN';
    if (EXPO_INVALID_TOKEN_ERRORS.has(errCode)) {
      summary.failedInvalidToken += 1;
      failedDelta += 1;
      // ticket id 即回执键，不含 token 本身；MVP 不建 push_tickets 表（任务书
      // 「能不动契约就不动」，无新表），INVALID 清理由 DeviceToken 注册链路的
      // 下一轮推送失败兜底（push.strategy 'invalid:' 标记路径已有）
      logger.warn({
        msg: 'RECEIPTS_SWEEP_TOKEN_INVALID',
        batchId,
        ticketId,
        expoError: errCode,
      });
    } else {
      summary.failedOther += 1;
      failedDelta += 1;
      logger.warn({
        msg: 'RECEIPTS_SWEEP_FAILED_TICKET',
        batchId,
        ticketId,
        expoError: errCode,
        message: receipt.message?.slice(0, 200),
      });
    }
  }

  // 批次聚合（幂等层 3：increment 只增不降，任务书 N4 #4）
  if (failedDelta > 0) {
    await db.notificationBatch.update({
      where: { id: batchId },
      data: { failedCount: { increment: failedDelta } },
    });
  }

  logger.info({
    msg: 'RECEIPTS_SWEEP_DISPOSITION',
    batchId,
    ...summary,
  });

  return summary;
}
