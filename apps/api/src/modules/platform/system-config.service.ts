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

/**
 * 派生缓存 key 清单（P1-3 修复，2026-08-25）
 *
 * 某些 SystemConfig key 被其他 service 二次加工后缓存到独立 Redis key。
 * SystemConfigService.update 只清自己的 `SystemConfig:{key}`，不知道派生缓存存在，
 * 导致运营改配置后派生缓存最长陈旧到自身 TTL。此处显式登记派生缓存，
 * update 时一并 DEL。
 *
 * 当前登记：
 *   - `about.socials` → AboutService 的 `AboutProfile` 缓存（TTL 1h，含解析后的 socials）
 *
 * 如未来新增更多派生缓存，在此 push 即可。
 */
const DERIVED_CACHE_KEYS: Array<{ keyPrefix: string; cacheKey: string }> = [
  { keyPrefix: 'about.', cacheKey: 'AboutProfile' },
];

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

    /**
     * P1-3 修复（2026-08-25）：同步失效派生缓存。
     * 如 `about.socials` 被 AboutService 解析后缓存在 `AboutProfile`，
     * 仅清 `SystemConfig:about.socials` 会导致关于页最长 1h 显示旧 socials。
     */
    const derivedKeys = DERIVED_CACHE_KEYS
      .filter((d) => key === d.keyPrefix || key.startsWith(d.keyPrefix))
      .map((d) => d.cacheKey);
    if (derivedKeys.length > 0) {
      await redis.del(...derivedKeys);
    }

    /**
     * 审计由 @Audit() 装饰器 + AuditInterceptor 统一负责
     * 2026-06-24 B1 修复：删除 service 内部手写的 auditLog.create（双写污染）
     * before/after 快照由 AuditInterceptor 通过 comparing response with cached existing row 实现
     */

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
