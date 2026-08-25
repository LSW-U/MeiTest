/**
 * About Service — 关于页可配置数据下发（P25 #2，2026-08-25）
 *
 * 职责：
 *   - stats 信任数据条：Prisma count（warehouses / shops / orders 原始数字，前端按 locale 格式化 200+/5万+）
 *   - socials 社交链接：从 SystemConfig key `about.socials` 读 JSON 字符串，运营可改
 *   - Redis 缓存（cache-aside，TTL 1h）：低频变动数据，避免每次请求打 3 次 count
 *
 * 决策依据：
 *   - P25 §2.2：stats 数字源 regions=Warehouse 去重计数 / merchants=Shop 计数 / orders=Order 计数
 *   - mission 留前端 i18n（文案稳定，后端不返），仅做 stats + socials
 *   - socials 入 SystemConfig（运营易变），不入环境变量（admin 可改）
 *   - socials.url 须 isOwnUrl 校验？否——社交链接是外部平台 URL（facebook.com / wa.me），
 *     非本服务上传资源，isOwnUrl 会全拒。改为只校验合法 URL + 白名单 host，防注入恶意 URL。
 *
 * 错误码：socials key 未 seed → 仅 socials 降级为 []（不阻断 stats 下发，P2-4 修复 2026-08-25）
 */
import { Injectable } from '@nestjs/common';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import type {
  AboutProfileType,
  AboutStatsType,
  SocialLinkItem,
  SocialLinkTypeValue,
} from '@meimart/api-contract';

/** about/profile 整体缓存 TTL（秒）—— 低频变动，1h */
const ABOUT_CACHE_TTL_SEC = 3600;
const ABOUT_CACHE_KEY = 'AboutProfile';

/** socials 配置项 key（SystemConfig） */
export const ABOUT_SOCIALS_KEY = 'about.socials';

/** 允许的社交链接 host 白名单（防运营误配恶意 URL 注入） */
const ALLOWED_SOCIAL_HOSTS: Record<SocialLinkTypeValue, string[]> = {
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'],
  whatsapp: ['wa.me', 'api.whatsapp.com', 'www.wa.me'],
  instagram: ['instagram.com', 'www.instagram.com'],
};

/** 关于页可配置数据视图（service → controller → client） */
export type AboutProfileView = AboutProfileType;

@Injectable()
export class AboutService {
  /**
   * 取关于页可配置数据（stats + socials）。
   *
   * 缓存策略：整体视图缓存到 Redis（TTL 1h）；运营改 SystemConfig 后需手动清缓存或等过期。
   * stats 用 Prisma count（不加状态过滤——MVP 展示累计规模，含历史订单）。
   */
  async getProfile(): Promise<AboutProfileView> {
    // 1. 先读缓存
    const cached = await redis.get(ABOUT_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as AboutProfileView;
      } catch {
        // 缓存损坏 → 忽略，重建
      }
    }

    // 2. 并行查 stats + socials
    const [regions, merchants, orders, socials] = await Promise.all([
      db.warehouse.count(),
      db.shop.count(),
      db.order.count(),
      this.loadSocials(),
    ]);

    const stats: AboutStatsType = { regions, merchants, orders };
    const profile: AboutProfileView = { stats, socials };

    // 3. 回填缓存
    await redis.set(ABOUT_CACHE_KEY, JSON.stringify(profile), 'EX', ABOUT_CACHE_TTL_SEC);

    return profile;
  }

  /**
   * 从 SystemConfig 读 about.socials（JSON 字符串），解析 + host 白名单校验。
   *
   * P2-4 修复（2026-08-25）：socials 是锦上添花字段，不应拖垮核心 stats。
   *   key 未 seed / 非 JSON / 非数组时不再抛 404，改为返回 [] + warn 日志，
   *   让 getProfile 的 stats 正常下发；前端 socials 区块降级隐藏即可。
   */
  private async loadSocials(): Promise<SocialLinkItem[]> {
    const row = await db.systemConfig.findUnique({ where: { key: ABOUT_SOCIALS_KEY } });
    if (!row) {
      logger.warn({
        msg: 'ABOUT_SOCIALS_NOT_SEEDED',
        key: ABOUT_SOCIALS_KEY,
      });
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      logger.warn({
        msg: 'ABOUT_SOCIALS_INVALID_JSON',
        key: ABOUT_SOCIALS_KEY,
      });
      return [];
    }

    if (!Array.isArray(parsed)) {
      logger.warn({
        msg: 'ABOUT_SOCIALS_NOT_ARRAY',
        key: ABOUT_SOCIALS_KEY,
      });
      return [];
    }

    // 逐项校验 type + url + host 白名单
    const result: SocialLinkItem[] = [];
    for (const item of parsed) {
      const link = this.validateSocialLink(item);
      if (link) result.push(link);
    }
    return result;
  }

  /**
   * 校验单个社交链接（type 合法 + url 合法 + host 在白名单）。
   * 非法项静默丢弃（运营误配不阻断整页，记日志即可）。
   */
  private validateSocialLink(item: unknown): SocialLinkItem | null {
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;
    const type = obj.type as string;
    const url = obj.url as string;

    if (typeof type !== 'string' || typeof url !== 'string') return null;
    if (!Object.keys(ALLOWED_SOCIAL_HOSTS).includes(type)) return null;

    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null; // 非合法 URL
    }

    const allowedHosts = ALLOWED_SOCIAL_HOSTS[type as SocialLinkTypeValue];
    if (!allowedHosts.includes(host)) return null; // host 不在白名单

    return { type: type as SocialLinkTypeValue, url };
  }
}

export { ABOUT_CACHE_TTL_SEC };
