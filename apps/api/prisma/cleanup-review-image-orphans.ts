/**
 * MeiMart 清理 MinIO reviews/image-* 孤儿对象（一次性脚本，P22 F2 配套，2026-08-19）
 *
 * 背景：反馈页（P22）此前复用 review-image 端点，real 模式上传的截图 URL 无消费方
 * （反馈表单不提交）→ MinIO 孤儿对象累积 + reviews/ 前缀语义污染。
 * F2 落地 feedback-image 端点（feedbacks/ 前缀）后，本脚本清理历史存量孤儿。
 *
 * 逻辑：
 *   1. MinIO listObjects 前缀 reviews/image-（评价图命名空间）
 *   2. DB 查 Review.images 全量 URL → 解析出 key 集合（DB 存完整 URL，取 bucket 后路径）
 *   3. MinIO 有 + DB 无 → 孤儿 → 删除
 *   注意：只清 reviews/image-*（不动 refunds/、products/、feedbacks/）；
 *   Review.images 存 URL 而非 key，比对时按 key 后缀匹配（防 endpoint 环境差异）。
 *
 * 安全：默认 DRY-RUN（只打印不删），--execute 才真删。
 *
 * 用法：cd apps/api && pnpm tsx prisma/cleanup-review-image-orphans.ts [--execute]
 */
import { PrismaClient } from '../src/prisma/client';
import { Client } from 'minio';

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes('--execute');

function loadMinioConfig() {
  const endpoint = process.env.OSS_ENDPOINT;
  const accessKey = process.env.OSS_ACCESS_KEY;
  const secretKey = process.env.OSS_SECRET_KEY;
  const bucket = process.env.OSS_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) {
    throw new Error('OSS_* env 不全（读 apps/api/.env：OSS_ENDPOINT/OSS_ACCESS_KEY/OSS_SECRET_KEY/OSS_BUCKET）');
  }
  const url = new URL(endpoint);
  return {
    client: new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:',
      accessKey,
      secretKey,
    }),
    bucket,
  };
}

/** URL → key（去 `${endpoint}/${bucket}/` 前缀；不匹配的返回 null） */
function urlToKey(url: string, endpoint: string, bucket: string): string | null {
  const base = `${endpoint.replace(/\/$/, '')}/${bucket}/`;
  if (!url.startsWith(base)) return null;
  return decodeURIComponent(url.slice(base.length));
}

async function main() {
  const endpoint = process.env.OSS_ENDPOINT!;
  const { client, bucket } = loadMinioConfig();

  // 1. DB 全量 Review.images URL → key 集合（reviews 表量级 MVP 小于万级，全量拉安全）
  const reviews = await prisma.review.findMany({ select: { images: true } });
  const referenced = new Set<string>();
  for (const r of reviews) {
    for (const url of r.images) {
      const key = urlToKey(url, endpoint, bucket);
      if (key) referenced.add(key);
    }
  }
  console.log(`DB Review.images 引用 key 数：${referenced.size}`);

  // 2. MinIO 列 reviews/image- 前缀对象
  const objects: { key: string; size: number }[] = [];
  const stream = client.listObjectsV2(bucket, 'reviews/image-', true);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (obj) => {
      if (obj.name) objects.push({ key: obj.name, size: obj.size ?? 0 });
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  console.log(`MinIO reviews/image-* 对象数：${objects.length}`);

  // 3. 孤儿 = MinIO 有 + DB 无
  const orphans = objects.filter((o) => !referenced.has(o.key));
  const orphanBytes = orphans.reduce((s, o) => s + o.size, 0);
  console.log(`孤儿对象数：${orphans.length}（约 ${(orphanBytes / 1024 / 1024).toFixed(2)} MB）`);
  if (orphans.length > 0) {
    console.log('孤儿 key 列表：');
    for (const o of orphans) console.log(`  - ${o.key} (${o.size} B)`);
  }

  // 4. 删除（仅 --execute）
  if (!EXECUTE) {
    console.log('\nDRY-RUN：未删除。确认列表无误后加 --execute 真删。');
    return;
  }
  if (orphans.length === 0) {
    console.log('无孤儿，跳过。');
    return;
  }
  await client.removeObjects(bucket, orphans.map((o) => o.key));
  console.log(`\n✅ 已删除 ${orphans.length} 个孤儿对象。`);
}

main()
  .catch((err) => {
    console.error('清理失败：', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
