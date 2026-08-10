/**
 * Upload Helpers — 图片上传共用校验（W7-feature 抽出，P13 售后图片 2026-08-10）
 *
 * 共用项（商品图 admin 端点 + 售后凭证 client 端点）：
 *   - MAX_FILE_SIZE / MIN_FILE_SIZE：5MB / 1B
 *   - ALLOWED_MIME：jpg/png/webp
 *   - detectImageFormat：magic bytes 校验（防 mime 欺骗）
 *
 * 各端点专用约束（不放 helpers）：
 *   - 商品图（upload.controller.ts）：200-2000px + 1:1 正方形
 *   - 售后凭证（upload-client.controller.ts）：最小 100×100，无 1:1 约束（任意比例）
 */

/** 最大文件 5MB（memoryStorage，5MB × 50 并发 ≈ 250MB Node heap） */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** 最小文件 1B（防空文件） */
export const MIN_FILE_SIZE = 1;

/** MIME → 扩展名映射（仅用于决定 key 后缀） */
export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Magic bytes 校验：读前 N 字节判断真实文件类型
 * 不依赖客户端 Content-Type（可伪造），防 mime 欺骗攻击
 *
 * 文件头参考：https://en.wikipedia.org/wiki/List_of_file_signatures
 */
export function detectImageFormat(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  // JPEG: FF D8 FF（3 字节）
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A（8 字节）
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  // WebP: RIFF....WEBP（12 字节，4-7 是 size 跳过）
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}
