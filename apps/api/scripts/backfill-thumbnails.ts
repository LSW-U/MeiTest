/**
 * 存量缩略图回填脚本（轻量化省流模块 批1，方案v2 D2c 2026-10-24）
 *
 * 语义（方案v2 §三批1 ②）：
 *   - 扫 bucket 内全部原图（无 -thumb 后缀的图片对象），逐个生成 600px `-thumb` 存同 bucket
 *   - 幂等：已存在对应 `-thumb` 的原图跳过，可重复跑
 *   - 默认 dry-run：只列出待生成清单不写入；--force 才真生成
 *   - 生成失败（损坏图/异形格式）逐个记 warn 继续，不中断整批（对齐上传降级语义）
 *
 * 运行方式（apps/api 目录下）：
 *   npx tsx scripts/backfill-thumbnails.ts            # dry-run：输出清单
 *   npx tsx scripts/backfill-thumbnails.ts --force    # 实际生成
 *
 * ⚠️ 验收只跑 dev bucket（方案v2 §六：回填脚本误伤生产 bucket 风险项）。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ── env 装配：复用 sim-delivery-test.ts 同款 .env 补载（tsx 不自动加载 .env）──
process.env.DOTENV_CONFIG_QUIET = 'true';
const envPath = path.resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

import { StorageService } from '../src/shared/storage/storage.service';
import { generateThumbnail, thumbKeyFor, THUMBNAIL_WIDTH } from '../src/modules/upload/thumbnail.helper';
import { detectImageFormat } from '../src/modules/upload/upload.helpers';

/** 判断 key 是否为缩略图对象（thumbKeyFor 逆运算的宽松版） */
function isThumbKey(key: string): boolean {
  const dot = key.lastIndexOf('.');
  const stem = dot > 0 ? key.slice(0, dot) : key;
  return stem.endsWith('-thumb');
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const endpoint = process.env.OSS_ENDPOINT;
  const bucket = process.env.OSS_BUCKET;
  if (!endpoint || !bucket) {
    console.error('[backfill] OSS_ENDPOINT/OSS_BUCKET env 不全，退出');
    process.exit(1);
  }
  // 防误伤生产：非 localhost endpoint 必须显式 --force（dry-run 也提示）
  const isLocal = /localhost|127\.0\.0\.1/.test(endpoint);
  if (!isLocal) {
    console.warn(`[backfill] ⚠️ endpoint 非 dev（${endpoint}）——验收只跑 dev bucket，请人工确认后加 --force`);
    if (force) {
      console.error('[backfill] 拒绝在非 dev bucket 上执行（如确需，改脚本白名单）');
      process.exit(1);
    }
  }

  const storage = new StorageService();
  await storage.onModuleInit();

  const objects = await storage.listAllObjects();
  const originals = objects.filter((o) => !isThumbKey(o.key) && /\.(jpe?g|png|webp)$/i.test(o.key));
  const existingThumbs = new Set(objects.filter((o) => isThumbKey(o.key)).map((o) => o.key));

  const pending = originals.filter((o) => !existingThumbs.has(thumbKeyFor(o.key)));
  const totalBytes = pending.reduce((s, o) => s + o.size, 0);
  console.log(`[backfill] bucket=${bucket} 图片对象 ${originals.length} 个，已有 -thumb ${existingThumbs.size} 个，待回填 ${pending.length} 个（${(totalBytes / 1024).toFixed(1)} KB 原图）`);
  for (const o of pending) {
    console.log(`  - ${o.key} (${(o.size / 1024).toFixed(1)} KB)`);
  }

  if (pending.length === 0) {
    console.log('[backfill] 存量缩略图覆盖率 100%，无需回填（幂等）');
    return;
  }
  if (!force) {
    console.log(`[backfill] dry-run 结束（未写入）。确认后加 --force 生成 ${THUMBNAIL_WIDTH}px 缩略图`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const o of pending) {
    try {
      // StorageService 未封装读取（仅 list/delete），脚本自建临时 minio client 读对象
      const buf = await getObjectBuffer(o.key);
      const thumb = await generateThumbnail(buf);
      if (!thumb) {
        console.warn(`[backfill] SKIP 非图片内容: ${o.key}`);
        failed += 1;
        continue;
      }
      // P3-1 修复（审查报告 2026-10-24）：contentType 按真实格式映射（octet-stream 会触发部分浏览器/CDN 下载）
      const fmt = detectImageFormat(buf)!;
      const contentType = `image/${fmt === 'jpg' ? 'jpeg' : fmt}`;
      const thumbKey = thumbKeyFor(o.key);
      await storage.uploadFile({ key: thumbKey, buffer: thumb, contentType });
      console.log(`[backfill] OK ${o.key} -> ${thumbKey} (${(thumb.length / 1024).toFixed(1)} KB)`);
      ok += 1;
    } catch (err) {
      console.warn(`[backfill] FAIL ${o.key}: ${(err as Error).message}`);
      failed += 1;
    }
  }
  console.log(`[backfill] 完成：成功 ${ok} / 失败 ${failed} / 总待回填 ${pending.length}`);
  if (failed > 0) process.exit(2);
}

/** 从 MinIO 读对象内容（回填脚本专用；StorageService 未封装读取，此处自建临时 client） */
async function getObjectBuffer(key: string): Promise<Buffer> {
  const { Client } = await import('minio');
  const url = new URL(process.env.OSS_ENDPOINT!);
  const client = new Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    accessKey: process.env.OSS_ACCESS_KEY!,
    secretKey: process.env.OSS_SECRET_KEY!,
  });
  const stream = await client.getObject(process.env.OSS_BUCKET!, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

main().catch((err) => {
  console.error('[backfill] 未捕获异常:', err);
  process.exit(1);
});
