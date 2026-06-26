/**
 * Idempotency 服务（防重复请求）
 *
 * 决策依据：
 * - schema.prisma IdempotencyKey 表：@@unique([scene, key]) + status(PENDING/SUCCESS/FAILED)
 * - 契约 v0.3 决策（unused model 接入 W3）
 *
 * 工作模式（write-through）：
 *   1. withIdempotency(scene, key, executor)
 *   2. key 未传 → 直接执行（向后兼容，不强制）
 *   3. key 已传：
 *      a. INSERT INTO idempotency_keys (scene, key, status=PENDING, expires_at=now+24h)
 *         唯一约束违反 → 记录已存在：
 *           - SUCCESS → 返回缓存的 responsePayload（幂等回放）
 *           - PENDING → 抛 IdempotencyConcurrentException（409，并发请求）
 *           - FAILED → 抛 IdempotencyConcurrentException（前端换新 key 重试）
 *           - EXPIRED → 复用空记录重新创建（删旧 + 重建）
 *      b. INSERT 成功 → 执行 executor
 *      c. 成功 → UPDATE status=SUCCESS, response_payload=JSON
 *      d. 失败 → UPDATE status=FAILED
 */
import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from '../db';
import { logger } from '../logger/logger';

/** Idempotency 场景标识（按业务枚举，避免不同业务复用同一 key 空间） */
export type IdempotencyScene =
  | 'ORDER_CREATE'
  | 'PAYMENT_CALLBACK'
  | 'PUSH_SEND'
  | 'CART_CHECKOUT';

/** 默认 TTL：24 小时 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * PENDING 状态的"短超时"：超过此时间视为 stuck（fn 永远 hang 住）
 * S4 修复：避免 fn hang 住导致 24h 内同 key 请求全部 409 死锁
 */
const STUCK_PENDING_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 递归深度上限：防 delete 失败导致无限循环（V2-B1 修复）
 */
const MAX_RECURSION_DEPTH = 3;

/** 并发冲突异常（前端可换新 key 重试） */
export class IdempotencyConcurrentException extends ConflictException {
  constructor(scene: string, key: string, status: string) {
    super({
      code: 'E-COMMON-009',
      message: `Idempotency key ${scene}:${key} already ${status}`,
    });
  }
}

@Injectable()
export class IdempotencyService {
  /**
   * 在幂等键保护下执行 fn
   *
   * @param scene 业务场景
   * @param key 客户端传入的 UUID（undefined 时不启用幂等，直接执行）
   * @param fn 业务函数
   * @param depth 递归深度（内部用，外部调用不传）— V2-B1 修复：限制 max=3 防 delete 失败导致无限循环
   */
  async withIdempotency<T>(
    scene: IdempotencyScene,
    key: string | undefined,
    fn: () => Promise<T>,
    depth = 0,
  ): Promise<T> {
    if (!key) {
      return fn();
    }

    // V2-B1 修复：入口深度校验（防极端场景栈溢出）
    if (depth >= MAX_RECURSION_DEPTH) {
      logger.error({
        msg: 'IDEMPOTENCY_RECURSION_LIMIT',
        scene,
        key,
        depth,
      });
      throw new IdempotencyConcurrentException(scene, key, 'RECURSION_LIMIT');
    }

    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);

    try {
      await db.idempotencyKey.create({
        data: { scene, key, status: 'PENDING', expiresAt },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // V2-B1 修复：透传 depth 到 handleExistingKey
        return this.handleExistingKey(scene, key, fn, depth);
      }
      throw e;
    }

    try {
      const result = await fn();

      await db.idempotencyKey.update({
        where: { scene_key: { scene, key } },
        data: {
          status: 'SUCCESS',
          responsePayload: result as unknown as Prisma.InputJsonValue,
        },
      });

      return result;
    } catch (e) {
      await db.idempotencyKey
        .update({
          where: { scene_key: { scene, key } },
          data: { status: 'FAILED' },
        })
        .catch((updateErr) => {
          logger.error({
            msg: 'IDEMPOTENCY_MARK_FAILED_ERROR',
            scene,
            key,
            error: (updateErr as Error).message,
          });
        });
      throw e;
    }
  }

  private async handleExistingKey<T>(
    scene: string,
    key: string,
    fn: () => Promise<T>,
    depth = 0,
  ): Promise<T> {
    // V2-B1 修复：递归深度限制（之前 M7 写了限制但 depth 永远=0，完全无效）
    if (depth >= MAX_RECURSION_DEPTH) {
      logger.error({
        msg: 'IDEMPOTENCY_RECURSION_LIMIT',
        scene,
        key,
        depth,
      });
      throw new IdempotencyConcurrentException(scene, key, 'RECURSION_LIMIT');
    }

    const existing = await db.idempotencyKey.findUnique({
      where: { scene_key: { scene, key } },
    });
    if (!existing) {
      return fn();
    }

    // S4 修复：已过期 OR stuck-pending（fn hang > 5min）→ 删旧重建，避免 24h 死锁
    const now = Date.now();
    const isExpired = existing.expiresAt.getTime() < now;
    const isStuckPending =
      existing.status === 'PENDING' &&
      now - existing.createdAt.getTime() > STUCK_PENDING_MS;

    if (isExpired || isStuckPending) {
      await db.idempotencyKey.delete({ where: { id: existing.id } });
      logger.warn({
        msg: 'IDEMPOTENCY_STUCK_KEY_CLEANED',
        scene,
        key,
        previousStatus: existing.status,
        reason: isExpired ? 'expired' : 'stuck-pending',
        depth,
      });
      // V2-B1 修复：透传 depth+1（之前漏传，导致限制永远不触发）
      return this.withIdempotency(scene as IdempotencyScene, key, fn, depth + 1);
    }

    if (existing.status === 'SUCCESS') {
      return existing.responsePayload as unknown as T;
    }

    // PENDING（未超时）/ FAILED：抛 409
    throw new IdempotencyConcurrentException(scene, key, existing.status);
  }
}
