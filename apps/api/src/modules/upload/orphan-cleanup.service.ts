/**
 * Orphan Cleanup Service — MinIO 孤儿图片清理（upload 模块批C U4/U10，2026-09-10）
 *
 * 语义（能力契约文档 CAPABILITY-CONTRACT.md §4）：
 *   - 引用集合 13 张表（任务书 13 字段全集 + plan v2 :56 二轮核补 shop.logoUrl）
 *   - 仅删「不在引用集合 且 lastModified 超宽限期 7 天」对象
 *   - DRY-RUN 默认：execute=false 只统计记日志；execute=true 才 deleteObjects
 *   - URL→key 容错：非本 bucket 前缀 / 畸形编码 URL 返 null 跳过（不误删）
 *   - 换头像旧对象仅被历史快照引用 → 永不清理（U10 已知代价，快照计入）
 *
 * 重建说明：本文件批C 原版因 statistics 批D 验收 git checkout 还原丢失，
 * 2026-09-10 按 transcript 重建（语义不变）。
 */
import { StorageService, StorageError } from '../../shared/storage/storage.service';
import { Inject } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import { db } from '../../shared/db';
import { ORPHAN_CLEANUP_GRACE_PERIOD_DAYS } from './orphan-cleanup.config';

/**
 * 引用集合来源表清单（恰 13 张——新增图片字段必须同步此清单 + 单测，
 * 漏扫即误删在线图；字段映射见 collectReferencedKeys）
 */
export const ORPHAN_REFERENCE_SOURCES = [
  'product',
  'sku',
  'banner',
  'category',
  'shop',
  'user',
  'riderProfile',
  'review',
  'feedback',
  'refund',
  'orderItem',
  'cartItem',
  'paymentIntent',
] as const;

/** 清理汇总（清理日志可审计——任务书批C 要求） */
export interface OrphanCleanupSummary {
  /** MinIO 全量对象数 */
  totalObjects: number;
  /** DB 引用集合 key 数（去重后） */
  referencedKeys: number;
  /** 无引用对象数 */
  unreferenced: number;
  /** 无引用但在宽限期内（保护） */
  withinGrace: number;
  /** 孤儿数（无引用 + 超宽限期） */
  orphans: number;
  /** 孤儿字节合计 */
  orphanBytes: number;
  /** 是否真删（false=dry-run） */
  executed: boolean;
  /** 真删时的 key 清单（dry-run 时也列出待删清单供审计） */
  keys: string[];
}

/**
 * URL → 本 bucket 对象 key。
 * - 仅接受 `${endpoint}/${bucket}/` 前缀（getPublicUrl 同款拼接）；外域/相对路径返 null
 * - decodeURIComponent 包 try/catch：畸形 % 序列返 null（不抛 URIError 中断清理）
 */
export function urlToOrphanKey(
  url: string,
  endpoint: string,
  bucket: string,
): string | null {
  const base = `${endpoint.replace(/\/$/, '')}/${bucket}/`;
  if (typeof url !== 'string' || !url.startsWith(base)) return null;
  const raw = url.slice(base.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export class OrphanCleanupService {
  // tsx 无 decorator metadata：显式 @Inject（upload.module 注册 'StorageServiceToken'）
  constructor(
    @Inject('StorageServiceToken')
    private readonly storage: StorageService,
  ) {}

  /**
   * 收集 DB 引用集合：单次 Promise.all 扫 13 表的全部图片字段。
   * 字段映射（⚠️ Refund 是 photos 非 images——schema.prisma:1212）：
   *   product.mainImage+images / sku.imageUrl / banner.imageUrl / category.iconUrl /
   *   shop.logoUrl / user.avatarUrl / riderProfile.avatarUrl+idCardImageUrl+licenseImageUrl /
   *   review.images+avatarUrl(快照U10) / feedback.images / refund.photos /
   *   orderItem.productImage(快照) / cartItem.productImage(快照) / paymentIntent.receiptUrl
   * banner/category 历史借道 products/main-* key——借道引用同样计入保护。
   */
  async collectReferencedKeys(endpoint: string, bucket: string): Promise<Set<string>> {
    const referenced = new Set<string>();
    const push = (url: unknown) => {
      const key = urlToOrphanKey(url as string, endpoint, bucket);
      if (key) referenced.add(key);
    };
    const pushArr = (urls: unknown) => {
      if (Array.isArray(urls)) urls.forEach(push);
    };

    const [
      products,
      skus,
      banners,
      categories,
      shops,
      users,
      riderProfiles,
      reviews,
      feedbacks,
      refunds,
      orderItems,
      cartItems,
      paymentIntents,
    ] = await Promise.all([
      db.product.findMany({ select: { mainImage: true, images: true } }),
      db.sku.findMany({ select: { imageUrl: true } }),
      db.banner.findMany({ select: { imageUrl: true } }),
      db.category.findMany({ select: { iconUrl: true } }),
      db.shop.findMany({ select: { logoUrl: true } }),
      db.user.findMany({ select: { avatarUrl: true } }),
      db.riderProfile.findMany({
        select: { avatarUrl: true, idCardImageUrl: true, licenseImageUrl: true },
      }),
      db.review.findMany({ select: { images: true, avatarUrl: true } }),
      db.feedback.findMany({ select: { images: true } }),
      db.refund.findMany({ select: { photos: true } }),
      db.orderItem.findMany({ select: { productImage: true } }),
      db.cartItem.findMany({ select: { productImage: true } }),
      db.paymentIntent.findMany({ select: { receiptUrl: true } }),
    ]);

    for (const p of products) {
      push(p.mainImage);
      pushArr(p.images);
    }
    for (const s of skus) push(s.imageUrl);
    for (const b of banners) push(b.imageUrl);
    for (const c of categories) push(c.iconUrl);
    for (const s of shops) push(s.logoUrl);
    for (const u of users) push(u.avatarUrl);
    for (const r of riderProfiles) {
      push(r.avatarUrl);
      push(r.idCardImageUrl);
      push(r.licenseImageUrl);
    }
    for (const r of reviews) {
      pushArr(r.images);
      push(r.avatarUrl);
    }
    for (const f of feedbacks) pushArr(f.images);
    for (const r of refunds) pushArr(r.photos);
    for (const oi of orderItems) push(oi.productImage);
    for (const ci of cartItems) push(ci.productImage);
    for (const pi of paymentIntents) push(pi.receiptUrl);

    return referenced;
  }

  /**
   * 执行一轮清理（dry-run 或真删）。
   * @param execute true=真删；false=dry-run 只统计记日志（默认）
   */
  async runCleanup({ execute = false }: { execute?: boolean } = {}): Promise<OrphanCleanupSummary> {
    const endpoint = process.env.OSS_ENDPOINT;
    const bucket = process.env.OSS_BUCKET;
    if (!endpoint || !bucket) {
      throw new StorageError('OSS_ENDPOINT/OSS_BUCKET env 不全，无法执行孤儿清理');
    }

    const referenced = await this.collectReferencedKeys(endpoint, bucket);
    const objects = await this.storage.listAllObjects();

    const graceCutoff = Date.now() - ORPHAN_CLEANUP_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    const orphanKeys: string[] = [];
    let orphanBytes = 0;
    let withinGrace = 0;
    for (const obj of objects) {
      if (referenced.has(obj.key)) continue;
      if (obj.lastModified.getTime() >= graceCutoff) {
        withinGrace += 1;
        continue;
      }
      orphanKeys.push(obj.key);
      orphanBytes += obj.size;
    }

    const summary: OrphanCleanupSummary = {
      totalObjects: objects.length,
      referencedKeys: referenced.size,
      // 无引用对象数 = 宽限期内 + 已判孤儿（纯计数，供审计对账）
      unreferenced: withinGrace + orphanKeys.length,
      withinGrace,
      orphans: orphanKeys.length,
      orphanBytes,
      executed: false,
      keys: orphanKeys,
    };

    if (!execute) {
      logger.info({
        msg: 'ORPHAN_CLEANUP_DRY_RUN',
        ...summary,
      });
      return summary;
    }

    if (orphanKeys.length > 0) {
      await this.storage.deleteObjects(orphanKeys);
    }
    summary.executed = true;
    logger.info({
      msg: 'ORPHAN_CLEANUP_EXECUTED',
      ...summary,
    });
    return summary;
  }
}
