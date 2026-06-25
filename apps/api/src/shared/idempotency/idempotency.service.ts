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
   */
  async withIdempotency<T>(
    scene: IdempotencyScene,
    key: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!key) {
      return fn();
    }

    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);

    try {
      await db.idempotencyKey.create({
        data: { scene, key, status: 'PENDING', expiresAt },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.handleExistingKey(scene, key, fn);
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
  ): Promise<T> {
    const existing = await db.idempotencyKey.findUnique({
      where: { scene_key: { scene, key } },
    });
    if (!existing) {
      return fn();
    }

    if (existing.expiresAt < new Date()) {
      await db.idempotencyKey.delete({ where: { id: existing.id } });
      return this.withIdempotency(scene as IdempotencyScene, key, fn);
    }

    if (existing.status === 'SUCCESS') {
      return existing.responsePayload as unknown as T;
    }

    throw new IdempotencyConcurrentException(scene, key, existing.status);
  }
}
