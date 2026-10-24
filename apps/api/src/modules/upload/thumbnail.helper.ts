/**
 * Thumbnail Helper — 服务端缩略图（轻量化省流模块 批1，方案v2 D2b/D2c 2026-10-24）
 *
 * 语义（方案v2 §三批1）：
 *   - 图片类上传写入时同步生成 600px `-thumb` 缩略图，存同 bucket
 *   - 生成失败降级只存原图（不阻断上传；SafeImage 拿不到缩略图 fallback 原图）
 *   - key 规则：`products/main-x.jpg` → `products/main-x-thumb.jpg`（扩展名前插入 -thumb）
 *
 * 消费方：upload.controller / upload-client.controller / rider-upload.controller
 * （三处写入链统一走 uploadWithThumbnail）；存量回填脚本复用 thumbKeyFor + generateThumbnail
 * （scripts/backfill-thumbnails.ts）。
 */
import sharp from 'sharp';
import { logger } from '../../shared/logger/logger';
import type { StorageService, UploadFileResult } from '../../shared/storage/storage.service';
import { detectImageFormat } from './upload.helpers';

/** 缩略图目标宽度（方案v2 D2b 拍板 600px；小于 600 的图不放大） */
export const THUMBNAIL_WIDTH = 600;

/**
 * 原图 key → 缩略图 key（扩展名前插入 `-thumb`）
 * 例：`products/main-1-ab.jpg` → `products/main-1-ab-thumb.jpg`
 * 无扩展名兜底：直接尾部追加 `-thumb`
 */
export function thumbKeyFor(key: string): string {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return `${key}-thumb`;
  return `${key.slice(0, dot)}-thumb${key.slice(dot)}`;
}

/**
 * 生成 600px 缩略图 buffer（保持原格式，fit inside 不裁切不放大）
 *
 * @returns 缩略图 buffer；无法识别格式（非 jpg/png/webp）返 null（调用方降级不存缩略图）
 * @throws sharp 处理失败（损坏图/异形格式）——由调用方决定降级策略
 */
export async function generateThumbnail(buffer: Buffer): Promise<Buffer | null> {
  // 复用 magic bytes 检测（防 sharp 对未知格式抛错路径不一致；与上传校验同源）
  const format = detectImageFormat(buffer);
  if (!format) return null;
  return sharp(buffer)
    .resize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_WIDTH, fit: 'inside', withoutEnlargement: true })
    .toFormat(format === 'jpg' ? 'jpeg' : format)
    .toBuffer();
}

/**
 * 上传原图 + 同步生成缩略图（upload 模块三 controller 写入链共用）
 *
 * - 原图上传失败：直接向上抛（沿用各 controller 既有 StorageError → 500 链路，不吞）
 * - 缩略图生成/上传失败：logger.warn 降级，只存原图，不阻断上传（方案v2 §六风险条目）
 *
 * @returns 原图上传结果（与原 uploadFile 返回一致，controller 返回体不变）
 */
export async function uploadWithThumbnail(
  storage: Pick<StorageService, 'uploadFile'>,
  input: { key: string; buffer: Buffer; contentType: string },
): Promise<UploadFileResult> {
  const result = await storage.uploadFile(input);
  try {
    const thumb = await generateThumbnail(input.buffer);
    if (thumb) {
      const thumbKey = thumbKeyFor(input.key);
      await storage.uploadFile({ key: thumbKey, buffer: thumb, contentType: input.contentType });
      logger.info({
        msg: 'thumbnail_generated',
        key: thumbKey,
        originalKey: input.key,
        originalSize: input.buffer.length,
        thumbSize: thumb.length,
      });
    } else {
      logger.warn({ msg: 'thumbnail_skipped_unknown_format', key: input.key });
    }
  } catch (err) {
    // 降级：只存原图不阻断上传（SafeImage 404 fallback 原图兜底）
    logger.warn({
      msg: 'thumbnail_generate_failed_degraded',
      key: input.key,
      error: (err as Error).message,
    });
  }
  return result;
}
