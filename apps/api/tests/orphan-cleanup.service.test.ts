/**
 * OrphanCleanupService 单测（upload 模块批C，2026-09-10）
 *
 * 覆盖场景（任务书批C 单测 ≥6）：
 *   1. 引用集合 13 字段完整性——漏扫任一来源表即 fail（借道 products/main-* 的
 *      banners.imageUrl/categories.iconUrl 必须被保护）
 *   2. Refund 是 photos 非 images（字段名防回归）
 *   3. 宽限期边界：7 天内不删 / 超期删
 *   4. dry-run 不删（默认安全）
 *   5. URL→key 容错：畸形 % 序列 / 外域 URL 跳过不误删
 *   6. execute 真删 + 部分失败抛错
 *   7. urlToOrphanKey 单元行为
 *
 * 重建说明：批C 原版因 statistics 批D 验收 git checkout 还原丢失，按 transcript 重建。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/shared/db', () => ({
  db: {
    product: { findMany: vi.fn().mockResolvedValue([]) },
    sku: { findMany: vi.fn().mockResolvedValue([]) },
    banner: { findMany: vi.fn().mockResolvedValue([]) },
    category: { findMany: vi.fn().mockResolvedValue([]) },
    shop: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    riderProfile: { findMany: vi.fn().mockResolvedValue([]) },
    review: { findMany: vi.fn().mockResolvedValue([]) },
    feedback: { findMany: vi.fn().mockResolvedValue([]) },
    refund: { findMany: vi.fn().mockResolvedValue([]) },
    orderItem: { findMany: vi.fn().mockResolvedValue([]) },
    cartItem: { findMany: vi.fn().mockResolvedValue([]) },
    paymentIntent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { db } from '../src/shared/db';
import {
  OrphanCleanupService,
  ORPHAN_REFERENCE_SOURCES,
  urlToOrphanKey,
} from '../src/modules/upload/orphan-cleanup.service';
import { ORPHAN_CLEANUP_GRACE_PERIOD_DAYS } from '../src/modules/upload/orphan-cleanup.config';

const ENDPOINT = 'http://localhost:9000';
const BUCKET = 'meimart';
const BASE = `${ENDPOINT}/${BUCKET}/`;

/** mock StorageService（只 mock 批C 扩展的两方法 + isOwnUrl 不涉及） */
function makeStorage() {
  return {
    listAllObjects: vi.fn().mockResolvedValue([]),
    deleteObjects: vi.fn().mockResolvedValue(0),
  };
}

const dbMock = db as unknown as Record<
  string,
  { findMany: ReturnType<typeof vi.fn> }
>;

function mockTable(table: string, rows: unknown[]) {
  dbMock[table].findMany.mockResolvedValue(rows);
}

describe('urlToOrphanKey', () => {
  it('本 bucket URL → key；带 %20 编码解码', () => {
    expect(urlToOrphanKey(`${BASE}products/main-1.jpg`, ENDPOINT, BUCKET)).toBe(
      'products/main-1.jpg',
    );
    expect(urlToOrphanKey(`${BASE}avatars/a%20b.png`, ENDPOINT, BUCKET)).toBe(
      'avatars/a b.png',
    );
  });

  it('外域 URL → null（不进引用集合，也不会误删——不在本 bucket 扫描范围）', () => {
    expect(urlToOrphanKey('https://evil.com/meimart/products/x.jpg', ENDPOINT, BUCKET)).toBeNull();
    expect(urlToOrphanKey('http://other-host:9000/meimart/products/x.jpg', ENDPOINT, BUCKET)).toBeNull();
  });

  it('畸形 % 序列 → null（不抛 URIError 中断清理）', () => {
    expect(urlToOrphanKey(`${BASE}products/%E4%BD%`, ENDPOINT, BUCKET)).toBeNull();
    expect(urlToOrphanKey(`${BASE}products/100%`, ENDPOINT, BUCKET)).toBeNull();
  });
});

describe('OrphanCleanupService.collectReferencedKeys — 13 字段完整性', () => {
  let service: OrphanCleanupService;

  beforeEach(() => {
    vi.clearAllMocks();
    // 全表清空（避免上个用例 mock 行泄漏）
    for (const table of ORPHAN_REFERENCE_SOURCES) {
      dbMock[table].findMany.mockResolvedValue([]);
    }
    service = new OrphanCleanupService(makeStorage() as never);
  });

  it('来源表清单恰好 13 项（12 张表 + paymentIntent），防清单漂移', () => {
    // 任务书批C：13 字段全集——product/sku/banner/category/shop/user/riderProfile/
    // review/feedback/refund/orderItem/cartItem/paymentIntent
    expect(ORPHAN_REFERENCE_SOURCES).toHaveLength(13);
    // Refund 字段名防回归：photos 非 images（schema.prisma:1212）
    expect(ORPHAN_REFERENCE_SOURCES).toContain('refund');
    expect(ORPHAN_REFERENCE_SOURCES).toContain('orderItem');
    expect(ORPHAN_REFERENCE_SOURCES).toContain('cartItem');
    expect(ORPHAN_REFERENCE_SOURCES).toContain('review');
  });

  it('每张来源表都被查询（漏一张即 fail）——借道 products/main-* 的 banner/category 必在内', async () => {
    await service.collectReferencedKeys(ENDPOINT, BUCKET);
    for (const table of ORPHAN_REFERENCE_SOURCES) {
      expect(dbMock[table].findMany, `表 ${table} 必须被扫描（漏扫即误删在线图）`).toHaveBeenCalledTimes(1);
    }
  });

  it('banners.imageUrl / categories.iconUrl 引用的 products/main-* key 被保护（借道语义）', async () => {
    mockTable('banner', [{ imageUrl: `${BASE}products/main-123-abc.jpg` }]);
    mockTable('category', [{ iconUrl: `${BASE}products/main-456-def.png` }]);

    const referenced = await service.collectReferencedKeys(ENDPOINT, BUCKET);

    expect(referenced.has('products/main-123-abc.jpg')).toBe(true);
    expect(referenced.has('products/main-456-def.png')).toBe(true);
  });

  it('Refund.photos（非 images）+ 快照 3 字段（orderItems/cartItems.productImage、reviews.avatarUrl）计入', async () => {
    mockTable('refund', [{ photos: [`${BASE}refunds/refund-1.jpg`, `${BASE}refunds/refund-2.jpg`] }]);
    mockTable('orderItem', [{ productImage: `${BASE}products/main-snapshot-1.jpg` }]);
    mockTable('cartItem', [{ productImage: `${BASE}products/main-snapshot-2.jpg` }]);
    mockTable('review', [{ images: [`${BASE}reviews/image-1.jpg`], avatarUrl: `${BASE}avatars/u1.png` }]);

    const referenced = await service.collectReferencedKeys(ENDPOINT, BUCKET);

    expect(referenced.has('refunds/refund-1.jpg')).toBe(true);
    expect(referenced.has('refunds/refund-2.jpg')).toBe(true);
    expect(referenced.has('products/main-snapshot-1.jpg')).toBe(true);
    expect(referenced.has('products/main-snapshot-2.jpg')).toBe(true);
    expect(referenced.has('reviews/image-1.jpg')).toBe(true);
    expect(referenced.has('avatars/u1.png')).toBe(true);
  });

  it('其余源字段（product.mainImage+images / sku / shop.logoUrl / user.avatarUrl / riderProfile 3 字段 / feedback / paymentIntent.receiptUrl）全计入 + 去重', async () => {
    mockTable('product', [
      { mainImage: `${BASE}products/main-dup.jpg`, images: [`${BASE}products/main-dup.jpg`, `${BASE}products/img-2.jpg`] },
    ]);
    mockTable('sku', [{ imageUrl: `${BASE}products/sku-1.jpg` }]);
    mockTable('shop', [{ logoUrl: `${BASE}shops/logo-1.png` }]);
    mockTable('user', [{ avatarUrl: `${BASE}avatars/user-1.jpg` }]);
    mockTable('riderProfile', [
      { avatarUrl: `${BASE}avatars/rider-1.jpg`, idCardImageUrl: `${BASE}riders/idcard-1.jpg`, licenseImageUrl: `${BASE}riders/license-1.jpg` },
    ]);
    mockTable('feedback', [{ images: [`${BASE}feedbacks/fb-1.jpg`] }]);
    mockTable('paymentIntent', [{ receiptUrl: `${BASE}receipts/rcpt-1.jpg` }]);

    const referenced = await service.collectReferencedKeys(ENDPOINT, BUCKET);

    expect(referenced.has('products/main-dup.jpg')).toBe(true);
    expect(referenced.has('products/img-2.jpg')).toBe(true);
    expect(referenced.has('products/sku-1.jpg')).toBe(true);
    expect(referenced.has('shops/logo-1.png')).toBe(true);
    expect(referenced.has('avatars/user-1.jpg')).toBe(true);
    expect(referenced.has('avatars/rider-1.jpg')).toBe(true);
    expect(referenced.has('riders/idcard-1.jpg')).toBe(true);
    expect(referenced.has('riders/license-1.jpg')).toBe(true);
    expect(referenced.has('feedbacks/fb-1.jpg')).toBe(true);
    expect(referenced.has('receipts/rcpt-1.jpg')).toBe(true);
    // 去重：mainImage 与 images[0] 同 URL → Set 收敛
    expect(referenced.size).toBe(10);
  });

  it('null/空串/外域 URL 不进引用集合也不抛错', async () => {
    mockTable('user', [{ avatarUrl: null }]);
    mockTable('product', [{ mainImage: `${BASE}products/ok.jpg`, images: ['', 'https://evil.com/x.jpg'] }]);

    const referenced = await service.collectReferencedKeys(ENDPOINT, BUCKET);

    expect(referenced.has('products/ok.jpg')).toBe(true);
    expect(referenced.size).toBe(1);
  });
});

describe('OrphanCleanupService.runCleanup — 宽限期/dry-run/execute', () => {
  let service: OrphanCleanupService;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const table of ORPHAN_REFERENCE_SOURCES) {
      dbMock[table].findMany.mockResolvedValue([]);
    }
    // runCleanup 读 OSS_ENDPOINT/OSS_BUCKET env——测试注入（vitest 隔离 per-file，不影响他文件）
    process.env.OSS_ENDPOINT = ENDPOINT;
    process.env.OSS_BUCKET = BUCKET;
    storage = makeStorage();
    service = new OrphanCleanupService(storage as never);
  });

  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  it('宽限期边界：无引用但 < 7 天 → withinGrace 保护不删；≥ 7 天 → 孤儿', async () => {
    // 宽限期边界恰好卡 7 天（graceCutoff = now - 7d；lastModified == cutoff 时
    // getTime() >= cutoff 为 true → 保护。测试用 6.9 天 / 7.1 天两侧验证）
    storage.listAllObjects.mockResolvedValue([
      { key: 'products/fresh.jpg', size: 100, lastModified: daysAgo(ORPHAN_CLEANUP_GRACE_PERIOD_DAYS - 0.1) },
      { key: 'products/stale.jpg', size: 200, lastModified: daysAgo(ORPHAN_CLEANUP_GRACE_PERIOD_DAYS + 0.1) },
    ]);

    const summary = await service.runCleanup({ execute: true });

    expect(summary.withinGrace).toBe(1);
    expect(summary.orphans).toBe(1);
    expect(summary.keys).toEqual(['products/stale.jpg']);
    expect(storage.deleteObjects).toHaveBeenCalledWith(['products/stale.jpg']);
  });

  it('dry-run（默认）：统计但不删（deleteObjects 零调用）', async () => {
    storage.listAllObjects.mockResolvedValue([
      { key: 'products/old-orphan.jpg', size: 500, lastModified: daysAgo(30) },
    ]);

    const summary = await service.runCleanup(); // 默认 execute=false

    expect(summary.executed).toBe(false);
    expect(summary.orphans).toBe(1);
    expect(summary.keys).toEqual(['products/old-orphan.jpg']);
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it('execute=true 真删 + 汇总字节/计数正确', async () => {
    mockTable('product', [{ mainImage: `${BASE}products/keep.jpg`, images: [] }]);
    storage.listAllObjects.mockResolvedValue([
      { key: 'products/keep.jpg', size: 100, lastModified: daysAgo(30) },
      { key: 'products/del-1.jpg', size: 1000, lastModified: daysAgo(30) },
      { key: 'products/del-2.jpg', size: 2000, lastModified: daysAgo(30) },
    ]);

    const summary = await service.runCleanup({ execute: true });

    expect(summary.executed).toBe(true);
    expect(summary.totalObjects).toBe(3);
    expect(summary.referencedKeys).toBe(1);
    expect(summary.orphans).toBe(2);
    expect(summary.orphanBytes).toBe(3000);
    expect(storage.deleteObjects).toHaveBeenCalledTimes(1);
    expect(storage.deleteObjects.mock.calls[0][0].sort()).toEqual(['products/del-1.jpg', 'products/del-2.jpg']);
  });

  it('deleteObjects 部分失败 → StorageError 抛出（BullMQ 重试，不静默吞错）', async () => {
    storage.listAllObjects.mockResolvedValue([
      { key: 'products/x.jpg', size: 1, lastModified: daysAgo(30) },
    ]);
    storage.deleteObjects.mockRejectedValue(new Error('MinIO removeObjects 部分失败 1/1'));

    await expect(service.runCleanup({ execute: true })).rejects.toThrow(/部分失败/);
  });

  it('孤儿为零时 execute 不调 deleteObjects（removeObjects 空数组不发起）', async () => {
    mockTable('product', [{ mainImage: `${BASE}products/keep.jpg`, images: [] }]);
    storage.listAllObjects.mockResolvedValue([
      { key: 'products/keep.jpg', size: 1, lastModified: daysAgo(30) },
    ]);

    const summary = await service.runCleanup({ execute: true });

    expect(summary.orphans).toBe(0);
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });
});
