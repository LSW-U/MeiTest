/**
 * SystemConfig Service — 平台系统配置（key-value + Redis 缓存）
 *
 * 决策依据：W-M-C-T 流程 3 W4 — platform M1 C2（提前到 W2，依赖 SystemConfig model）
 *
 * Redis 缓存策略（cache-aside）：
 *   - 读：先查 redis:SystemConfig:{key}，miss 时查 DB 回填（TTL 5 分钟）
 *   - 写：UPDATE DB → DEL redis key（避免读旧值）
 *   - 全部配置项 key 由 seed.ts FLOW M 段预置（业务方拿不到不存在的 key）
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import type { SystemConfigItemType } from '@meimart/api-contract';

const CACHE_TTL_SEC = 300;
const cacheKey = (key: string) => `SystemConfig:${key}`;

@Injectable()
export class SystemConfigService {
  async list(): Promise<SystemConfigItemType[]> {
    const rows = await db.systemConfig.findMany({ orderBy: { key: 'asc' } });
    return rows.map(this.toDto);
  }

  async get(key: string): Promise<string | null> {
    const cached = await redis.get(cacheKey(key));
    if (cached !== null) return cached;

    const row = await db.systemConfig.findUnique({ where: { key } });
    if (!row) return null;

    await redis.set(cacheKey(key), row.value, 'EX', CACHE_TTL_SEC);
    return row.value;
  }

  async update(
    key: string,
    value: string,
    description: string | undefined,
    updatedBy: string,
    /** 审计上下文（W4 完善：配置变更写 AuditLog） */
    auditCtx?: {
      deviceType?: 'CLIENT_APP' | 'RIDER_APP' | 'ADMIN_WEB';
      perspective?: string;
      ip?: string | null;
      userAgent?: string | null;
      traceId?: string | null;
    },
  ): Promise<SystemConfigItemType> {
    const existing = await db.systemConfig.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException({
        code: 'E-PLATFORM-002',
        message: `System config key not found: ${key}`,
      });
    }

    const updated = await db.systemConfig.update({
      where: { key },
      data: {
        value,
        ...(description !== undefined ? { description } : {}),
        updatedBy,
      },
    });

    /** 写后失效缓存（而不是更新，避免与并发读竞争） */
    await redis.del(cacheKey(key));

    /** W4：配置变更写 AuditLog（before/after 快照便于追溯） */
    await db.auditLog.create({
      data: {
        userId: updatedBy,
        action: 'UPDATE_SYSTEMCONFIG',
        resourceType: 'SystemConfig',
        resourceId: key,
        beforeData: { value: existing.value, description: existing.description } as object,
        afterData: { value: updated.value, description: updated.description } as object,
        deviceType: auditCtx?.deviceType ?? null,
        perspective: auditCtx?.perspective ?? null,
        ip: auditCtx?.ip ?? null,
        userAgent: auditCtx?.userAgent ?? null,
        traceId: auditCtx?.traceId ?? null,
      },
    });

    logger.info({
      msg: 'SYSTEM_CONFIG_UPDATED',
      key,
      updatedBy,
      beforeValue: existing.value,
      afterValue: updated.value,
    });

    return this.toDto(updated);
  }

  private toDto(row: {
    key: string;
    value: string;
    description: string | null;
    updatedAt: Date;
    updatedBy: string | null;
  }): SystemConfigItemType {
    return {
      key: row.key,
      value: row.value,
      description: row.description,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    };
  }
}

export { CACHE_TTL_SEC };
