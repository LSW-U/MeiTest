/**
 * e2e: 上传链路缩略图断言（轻量化省流模块 批1 P2-1，2026-10-24）
 *
 * 覆盖（方案v2 §三批1③「上传 e2e 补缩略图断言」）：
 *   - POST /admin/uploads/product-image 走真实链路（multer → uploadWithThumbnail → 真实 sharp → MinIO）
 *   - 断言原图 + `-thumb` 对象都存在于 bucket（listObjects 实证，非 mock）
 *   - 断言缩略图宽度 ≤ 600px（sharp 读回元数据）
 *
 * 前置：docker compose up（MinIO + API dev server），缺一则 describeWhenApiUp 全套 skip。
 * 与 e2e-guard 同款探活守卫 + MinIO 可达性守卫（无 env 时 skip，不红）。
 *
 * 产物清理：上传对象用唯一 key 前缀 thumb-e2e- 标记，测试尾随删除（自造自清，
 * 对齐孤儿清理审查「真库写路径冒烟自造自清范式」）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { describeWhenApiUp } from './helpers/e2e-guard';
import sharp from 'sharp';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';

// ── MinIO 守卫：OSS_* env 不全 → skip（无 MinIO 环境不红）──
const OSS_ENDPOINT = process.env.OSS_ENDPOINT;
const OSS_BUCKET = process.env.OSS_BUCKET;
const OSS_READY = Boolean(OSS_ENDPOINT && OSS_BUCKET && process.env.OSS_ACCESS_KEY && process.env.OSS_SECRET_KEY);

/** 测试产物 key 前缀（自造自清标记） */
const KEY_PREFIX = 'thumb-e2e-';
const createdKeys: string[] = [];

/** 直连 MinIO 的临时 client（e2e 专用，复用脚本 getObjectBuffer 同款装配） */
async function getMinioClient() {
  const { Client } = await import('minio');
  const url = new URL(OSS_ENDPOINT!);
  return new Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    accessKey: process.env.OSS_ACCESS_KEY!,
    secretKey: process.env.OSS_SECRET_KEY!,
  });
}

async function objectExists(client: any, key: string): Promise<boolean> {
  try {
    await client.statObject(OSS_BUCKET!, key);
    return true;
  } catch {
    return false;
  }
}

describeWhenApiUp('e2e: 上传链路缩略图（product-image → -thumb 对象存在 + ≤600px）', () => {
  // MinIO env 不全 → 本套件也 skip（不红）
  if (!OSS_READY) {
    describe.skip('（OSS_* env 不全，MinIO 断言跳过）', () => {});
    return;
  }

  afterAll(async () => {
    // 自造自清：删除本套件创建的对象（原图 + thumb）
    if (!OSS_READY || createdKeys.length === 0) return;
    try {
      const client = await getMinioClient();
      await client.removeObjects(OSS_BUCKET!, createdKeys);
    } catch {
      // 清理失败不遮蔽测试结果（dev bucket 孤儿由 orphan-cleanup 兜底）
    }
  });

  it('上传 600x600 png → 原图与 -thumb 都在 bucket，thumb 宽 ≤600', async () => {
    // 1. mock-login 拿 token（SUPER_ADMIN 可调 admin uploads）
    const loginRes = await fetch(`${API}/common/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'SUPER_ADMIN', deviceType: 'admin_web' }),
    });
    const loginBody = await loginRes.json();
    expect(loginBody.success).toBe(true);
    const token = loginBody.data.accessToken as string;

    // 2. 生成真实 600x600 png（真实 sharp 链路输入；product-image 端点强制 1:1）
    const png = await sharp({
      create: { width: 600, height: 600, channels: 3, background: { r: 40, g: 120, b: 200 } },
    })
      .png()
      .toBuffer();

    // 3. multipart 上传
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'thumb-e2e.png');
    const upRes = await fetch(`${API}/admin/uploads/product-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const upBody = await upRes.json();
    expect(upBody.success).toBe(true);
    const key = upBody.data.key as string;
    expect(key).toBeTruthy();
    createdKeys.push(key, key.replace(/\.png$/, '-thumb.png'));

    // 4. MinIO 实证：原图 + -thumb 对象都存在
    const client = await getMinioClient();
    expect(await objectExists(client, key)).toBe(true);
    const thumbKey = key.replace(/\.png$/, '-thumb.png');
    expect(await objectExists(client, thumbKey)).toBe(true);

    // 5. 缩略图尺寸 ≤600px（sharp 读回真实对象）
    const stream = await client.getObject(OSS_BUCKET!, thumbKey);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const meta = await sharp(Buffer.concat(chunks)).metadata();
    expect(meta.width).toBeLessThanOrEqual(600);
  });
});
