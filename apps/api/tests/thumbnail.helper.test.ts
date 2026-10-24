/**
 * Thumbnail Helper 单测（轻量化省流模块 批1，2026-10-24）
 *
 * 覆盖：
 *   - thumbKeyFor：jpg/png/webp/无扩展名/多点 key
 *   - generateThumbnail：真实 sharp 生成 600px 缩略图 / 小图不放大 / 非图片返 null
 *   - uploadWithThumbnail：原图上传失败向上抛；缩略图成功双写；生成失败降级只存原图不阻断
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { thumbKeyFor, generateThumbnail, uploadWithThumbnail, THUMBNAIL_WIDTH } from '../src/modules/upload/thumbnail.helper';
import sharp from 'sharp';

// 生成一张真实 png（sharp 本仓依赖，测试期可用）——5MB 上限内的小图
async function makePng(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('thumbKeyFor', () => {
  it('jpg → 扩展名前插入 -thumb', () => {
    expect(thumbKeyFor('products/main-1-ab.jpg')).toBe('products/main-1-ab-thumb.jpg');
  });
  it('png/webp 同规则', () => {
    expect(thumbKeyFor('a/b.png')).toBe('a/b-thumb.png');
    expect(thumbKeyFor('a/b.webp')).toBe('a/b-thumb.webp');
  });
  it('无扩展名 → 尾部追加', () => {
    expect(thumbKeyFor('products/img')).toBe('products/img-thumb');
  });
  it('多点扩展名取最后一段', () => {
    expect(thumbKeyFor('a.b.c.jpg')).toBe('a.b.c-thumb.jpg');
  });
});

describe('generateThumbnail（真实 sharp）', () => {
  it('1200x800 → 600px 宽缩略图（fit inside）', async () => {
    const buf = await makePng(1200, 800);
    const thumb = await generateThumbnail(buf);
    expect(thumb).not.toBeNull();
    const meta = await sharp(thumb!).metadata();
    expect(meta.width).toBe(THUMBNAIL_WIDTH);
    expect(meta.height).toBe(400);
    expect(thumb!.length).toBeLessThan(buf.length);
  });

  it('小于 600px 的图不放大', async () => {
    const buf = await makePng(400, 300);
    const thumb = await generateThumbnail(buf);
    const meta = await sharp(thumb!).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('非图片内容返 null', async () => {
    expect(await generateThumbnail(Buffer.from('not an image at all'))).toBeNull();
  });
});

describe('uploadWithThumbnail', () => {
  const png = Buffer.from('fake-png-bytes'); // 会被 sharp 判为非图 → 走 unknown-format 降级路径也可控
  let storage: { uploadFile: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    storage = { uploadFile: vi.fn().mockResolvedValue({ url: 'u', key: 'k', bucket: 'b', size: 1 }) };
  });

  it('缩略图成功：双写原图 + -thumb', async () => {
    const buf = await makePng(1200, 800);
    await uploadWithThumbnail(storage, { key: 'products/a.jpg', buffer: buf, contentType: 'image/jpeg' });
    expect(storage.uploadFile).toHaveBeenCalledTimes(2);
    expect(storage.uploadFile.mock.calls[1][0].key).toBe('products/a-thumb.jpg');
  });

  it('缩略图生成失败：降级只存原图，不抛错', async () => {
    // magic bytes 是 png 但内容损坏 → sharp 抛错 → 降级路径
    const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await expect(
      uploadWithThumbnail(storage, { key: 'products/corrupt.png', buffer: corrupt, contentType: 'image/png' }),
    ).resolves.toMatchObject({ key: 'k' });
    expect(storage.uploadFile).toHaveBeenCalledTimes(1); // 仅原图
  });

  it('原图上传失败：向上抛，不再尝试缩略图', async () => {
    storage.uploadFile.mockRejectedValueOnce(new Error('minio down'));
    await expect(
      uploadWithThumbnail(storage, { key: 'products/a.jpg', buffer: png, contentType: 'image/jpeg' }),
    ).rejects.toThrow('minio down');
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
  });
});
