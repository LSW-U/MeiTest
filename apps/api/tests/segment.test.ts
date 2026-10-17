/**
 * Segment 模块单测（客户画像批2 2026-10-18）
 *
 * 覆盖 P2 自检对应的断言：
 *   1. 看板对账（P2-1）：归层用与批1 同一 getLifecycleStage + 同一 G5 阈值；
 *      SQL 口径断言（COMPLETED+CANCELLED、不过滤 deletedAt、两段 AT TIME ZONE 不涉及）
 *   2. 共现边界（P2-2）：单买家商品对不去重（全量事实）；baseOrderCount=0 时 share=0
 *   3. grant 幂等（P2-3）：P2002 跳过不报错（重复发放不双券）；上限截断（batchLimit 硬顶）
 *   4. 频控（P2-3）：rateLimit 拒绝 → E-SEGMENT-003 429
 *   5. 403 + 审计（P2-4/P2-5）：controller @Roles('SUPER_ADMIN') 元数据；导出落
 *      EXPORT_SEGMENT_USERS 审计；grant 走 AuditInterceptor（@Audit 装饰器存在）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  userCount: vi.fn(),
  productFindUnique: vi.fn(),
  promotionFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  auditLogCreate: vi.fn(),
  segmentRuleFindMany: vi.fn(),
  segmentRuleCreate: vi.fn(),
  rateLimit: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    $queryRaw: m.queryRaw,
    $transaction: m.transaction,
    user: { count: m.userCount, findMany: m.userFindMany },
    product: { findUnique: m.productFindUnique },
    promotion: { findUnique: m.promotionFindUnique },
    systemConfig: { findUnique: m.systemConfigFindUnique },
    auditLog: { create: m.auditLogCreate },
    segmentCouponRule: { findMany: m.segmentRuleFindMany, create: m.segmentRuleCreate },
  },
}));

vi.mock('../src/shared/cache', () => ({
  rateLimit: m.rateLimit,
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: m.loggerWarn, info: m.loggerInfo, error: vi.fn() },
}));

import { SegmentService } from '../src/modules/segment/segment.service';
import { AdminSegmentController } from '../src/modules/segment/admin-segment.controller';
import { RolesGuard } from '../src/shared/guards/roles.guard';
import { resetSegmentConfigCacheForTest, SEGMENT_BATCH_GRANT_CONFIG } from '../src/modules/segment/segment.config';
import { resetProfileThresholdsCacheForTest } from '../src/modules/profile/profile.config';
import type { LifecycleStage } from '../src/modules/profile/lifecycle';

const T = { repeatThreshold: 3, sleepingDays: 30, churnedDays: 90 };

// R=now-100 天 → CHURNED（用于固定归层）
const CHURNED_LAST_AT = new Date(Date.now() - 100 * 86_400_000);
const ACTIVE_LAST_AT = new Date(Date.now() - 3 * 86_400_000);

function aggRow(userId: string, f: number, m: number, lastAt: Date | null) {
  return { user_id: userId, f_count: BigInt(f), m_total: BigInt(m), last_at: lastAt };
}

/** 从 mock 调用提取全部 SQL 文本（tagged template 段 + Prisma.raw 字面量） */
function sqlText(callIndex: number): string {
  const args = m.queryRaw.mock.calls[callIndex] as unknown[];
  const tpl = args[0] as unknown as string[];
  const raws = args
    .slice(1)
    .flatMap((a) => {
      const raw = a as { strings?: string[] };
      if (Array.isArray(raw?.strings)) return raw.strings;
      return [];
    });
  return tpl.join(' ') + ' ' + raws.join(' ');
}

describe('SegmentService.getSegmentDashboard — 看板对账（P2-1）', () => {
  let service: SegmentService;

  beforeEach(() => {
    vi.resetAllMocks();
    resetSegmentConfigCacheForTest();
    resetProfileThresholdsCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null);
    m.rateLimit.mockResolvedValue({ allowed: true, current: 0, limit: 1, retryAfter: 0 });
    service = new SegmentService();
  });

  it('归层与批1 同函数同阈值：F=5/R=100 → CHURNED；F=5/R=3 → ACTIVE；F=0 不进扫描（NEW 补齐）', async () => {
    m.queryRaw
      .mockResolvedValueOnce([
        aggRow('u-churned', 5, 5000, CHURNED_LAST_AT),
        aggRow('u-active', 5, 9000, ACTIVE_LAST_AT),
      ])
      .mockResolvedValue([]);
    m.userCount.mockResolvedValue(3); // 3 用户，2 有购买 → NEW=1

    const data = await service.getSegmentDashboard();
    const byStage = new Map(data.buckets.map((b) => [b.stage, b]));

    expect(byStage.get('CHURNED')!.userCount).toBe(1);
    expect(byStage.get('ACTIVE')!.userCount).toBe(1);
    expect(byStage.get('NEW')!.userCount).toBe(1);
    expect(data.purchasedUsers).toBe(2);
    expect(data.totalUsers).toBe(3);
    // GMV 占比：5000 / 14000
    expect(byStage.get('CHURNED')!.gmvShare).toBeCloseTo(5000 / 14000);
  });

  it('SQL 口径同源：COMPLETED+CANCELLED 字面量、无 deleted_at 过滤（R-a 红线）', async () => {
    m.queryRaw.mockResolvedValue([]);
    m.userCount.mockResolvedValue(0);
    await service.getSegmentDashboard();
    const text = sqlText(0);
    expect(text).toContain("'COMPLETED', 'CANCELLED'");
    expect(text).not.toContain('deleted_at');
  });

  it('阈值可配生效（G5 同源）：sleepingDays=14 时 R=20 从 ACTIVE 判变 SLEEPING', async () => {
    // 配置读 SystemConfig
    m.systemConfigFindUnique.mockResolvedValue({
      key: 'profile.thresholds',
      value: JSON.stringify({ repeatThreshold: 3, sleepingDays: 14, churnedDays: 60 }),
    });
    const r20 = new Date(Date.now() - 20 * 86_400_000);
    m.queryRaw.mockResolvedValueOnce([aggRow('u-1', 5, 1000, r20)]).mockResolvedValue([]);
    m.userCount.mockResolvedValue(1);

    const data = await service.getSegmentDashboard();
    expect(data.buckets.find((b) => b.stage === 'SLEEPING')!.userCount).toBe(1);
  });
});

describe('SegmentService.getCoPurchase — 共现边界（P2-2）', () => {
  let service: SegmentService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new SegmentService();
  });

  it('商品不存在 → 404 E-SEGMENT-005（批2修复 P3-1：不再借用 E-PROFILE-001 用户语义）', async () => {
    m.productFindUnique.mockResolvedValue(null);
    await expect(service.getCoPurchase('nope')).rejects.toMatchObject({
      response: { code: 'E-SEGMENT-005' },
    });
  });

  it('baseOrderCount=0（无订单）→ share=0，不除零', async () => {
    m.productFindUnique.mockResolvedValue({ id: 'p-1', name: { en: 'Milk' } });
    m.queryRaw.mockResolvedValue([{ cnt: 0n }]); // 分母（mock 同返回也覆盖共现查询）
    const data = await service.getCoPurchase('p-1', 'en');
    expect(data.baseOrderCount).toBe(0);
    // share=0（不除零），无真实共现行时 items 为空或全 0
    expect(data.items.every((i) => i.share === 0 && i.coOrderCount === 0)).toBe(true);
  });

  it('单买家商品对不去重（全量事实）：共现订单数照返，share 按 base 计', async () => {
    m.productFindUnique.mockResolvedValue({ id: 'p-1', name: { en: 'Milk' } });
    m.queryRaw
      .mockResolvedValueOnce([{ cnt: 2n }]) // 分母：目标商品 2 单
      .mockResolvedValueOnce([{ product_id: 'p-2', name: { en: 'Bread' }, cnt: 2n }]); // 共现 2 单（同一买家）
    const data = await service.getCoPurchase('p-1', 'en');
    expect(data.items[0].coOrderCount).toBe(2);
    expect(data.items[0].share).toBeCloseTo(1);
  });
});

describe('SegmentService.batchGrantCoupons — 幂等 + 上限（P2-3）', () => {
  let service: SegmentService;

  beforeEach(() => {
    vi.resetAllMocks();
    resetSegmentConfigCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null); // 默认 batchLimit=500
    m.rateLimit.mockResolvedValue({ allowed: true, current: 0, limit: 1, retryAfter: 0 });
    m.promotionFindUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'SAVE10',
      totalQuota: null,
      usedCount: 0,
    });
    service = new SegmentService();
  });

  it('幂等：P2002（已持有）→ skipped，不报错，重复发放不产生双券', async () => {
    const err = new (class extends Error {
      code = 'P2002';
    })();
    m.transaction.mockRejectedValueOnce(err).mockResolvedValueOnce({});
    m.transaction.mockRejectedValueOnce(err);

    const result = await service.batchGrantCoupons('promo-1', ['u-1', 'u-2', 'u-3'], 'admin-1');
    expect(result.granted).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.total).toBe(3);
    // P2-1 修复：频控收敛 controller 单层 → service 不再调 rateLimit（无双层消耗窗口）
    expect(m.rateLimit).not.toHaveBeenCalled();
  });

  it('单批上限截断：userIds > batchLimit（默认 500）→ E-SEGMENT-002 400', async () => {
    const tooMany = Array.from({ length: SEGMENT_BATCH_GRANT_CONFIG.batchLimit + 1 }, (_, i) => `u-${i}`);
    await expect(service.batchGrantCoupons('promo-1', tooMany, 'admin-1')).rejects.toMatchObject({
      response: { code: 'E-SEGMENT-002' },
    });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('G5 可配上限生效：SystemConfig batchLimit=2 时 3 个即拒', async () => {
    m.systemConfigFindUnique.mockResolvedValue({
      key: 'segment.batchGrant',
      value: JSON.stringify({ batchLimit: 2, rateLimitPerMinute: 1 }),
    });
    await expect(
      service.batchGrantCoupons('promo-1', ['u-1', 'u-2', 'u-3'], 'admin-1'),
    ).rejects.toMatchObject({ response: { code: 'E-SEGMENT-002' } });
  });

  it('券模板不存在 → 404 E-COUPON-004', async () => {
    m.promotionFindUnique.mockResolvedValue(null);
    await expect(service.batchGrantCoupons('nope', ['u-1'], 'admin-1')).rejects.toMatchObject({
      response: { code: 'E-COUPON-004' },
    });
  });

  it('配额满（QUOTA_EXHAUSTED）→ failed 计数，不中断整批', async () => {
    m.transaction.mockRejectedValue(new Error('QUOTA_EXHAUSTED'));
    const result = await service.batchGrantCoupons('promo-1', ['u-1', 'u-2'], 'admin-1');
    expect(result.failed).toBe(2);
    expect(result.granted).toBe(0);
  });
});

describe('grant 频控（P2-3，controller 层）', () => {
  it('rateLimit 拒绝 → E-SEGMENT-003 429', async () => {
    vi.resetAllMocks();
    resetSegmentConfigCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null);
    m.rateLimit.mockResolvedValue({ allowed: false, current: 1, limit: 1, retryAfter: 42 });
    const { db: dbMock } = (await import('../src/shared/db')) as never as {
      db: { systemConfig: { findUnique: ReturnType<typeof vi.fn> } };
    };
    dbMock.systemConfig.findUnique.mockResolvedValue(null);
    const controller = new AdminSegmentController({} as never);
    await expect(
      controller.grantCoupons(
        { promotionId: 'p', userIds: ['u-1'] } as never,
        { user: { sub: 'a' }, headers: {}, ip: '1' } as never,
      ),
    ).rejects.toMatchObject({ response: { code: 'E-SEGMENT-003' } });
  });
});

// ============================================================================
// P2-4 / P2-5：403 + 审计
// ============================================================================

describe('AdminSegmentController — 门禁 + 审计（P2-4/P2-5）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.auditLogCreate.mockResolvedValue({});
  });

  it('controller 元数据声明 SUPER_ADMIN；RolesGuard 拒 CUSTOMER/RIDER', () => {
    expect(Reflect.getMetadata('roles', AdminSegmentController)).toEqual(['SUPER_ADMIN']);
    const guard = new RolesGuard(new (class {
      getAllAndOverride = (key: string) => (key === 'roles' ? ['SUPER_ADMIN'] : undefined);
    })() as never);
    const handler = () => {};
    const ctx = (role: string) =>
      ({
        getHandler: () => handler,
        getClass: () => AdminSegmentController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: 'x', role }, headers: {}, ip: '1' }),
        }),
      }) as never;
    expect(() => guard.canActivate(ctx('CUSTOMER'))).toThrow();
    expect(() => guard.canActivate(ctx('RIDER'))).toThrow();
    expect(guard.canActivate(ctx('SUPER_ADMIN'))).toBe(true);
  });

  it('导出（GET）显式落 EXPORT_SEGMENT_USERS 审计（P2-4 查看即审计）', async () => {
    const service = {
      exportSegmentCsv: vi.fn().mockResolvedValue('h1,h2\nv1,v2'),
    } as never;
    const controller = new AdminSegmentController(service);
    const res = {
      setHeader: vi.fn(),
    } as never;
    const csv = await controller.exportCsv(
      { stage: 'ACTIVE', lang: 'zh' } as never,
      {
        user: { sub: 'admin-1' },
        headers: { 'x-perspective': 'platform', 'user-agent': 'UA/1' },
        ip: '10.0.0.1',
      } as never,
      res,
    );
    expect(csv).toContain('h1');
    await new Promise((r) => setTimeout(r, 0));
    expect(m.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        action: 'EXPORT_SEGMENT_USERS',
        resourceType: 'CustomerSegment',
        resourceId: 'ACTIVE',
        perspective: 'platform',
        ip: '10.0.0.1',
        userAgent: 'UA/1',
      }),
    });
  });

  it('导出审计写失败不阻塞导出（catch → warn）', async () => {
    m.auditLogCreate.mockRejectedValue(new Error('db down'));
    const service = { exportSegmentCsv: vi.fn().mockResolvedValue('x') } as never;
    const controller = new AdminSegmentController(service);
    await controller.exportCsv(
      { stage: 'NEW', lang: 'en' } as never,
      { user: { sub: 'a' }, headers: {}, ip: undefined } as never,
      { setHeader: vi.fn() } as never,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'segment_export_audit_write_failed' }),
    );
  });

  it('grant 有 @Audit 装饰器且元数据具体（P3-2：resource=UserCoupon，非仅"有键"）', () => {
    // @Audit 写入的元数据键（与 audit.decorator 实现一致：AUDIT_KEY='audit'）
    const opts = Reflect.getMetadata('audit', AdminSegmentController.prototype.grantCoupons);
    expect(opts).toMatchObject({ resource: 'UserCoupon' });
    // 写审计的三个规则端点也逐一断言 resource
    expect(Reflect.getMetadata('audit', AdminSegmentController.prototype.createRule))
      .toMatchObject({ resource: 'SegmentCouponRule' });
    expect(Reflect.getMetadata('audit', AdminSegmentController.prototype.updateRule))
      .toMatchObject({ resource: 'SegmentCouponRule', resourceIdParam: 'id' });
    expect(Reflect.getMetadata('audit', AdminSegmentController.prototype.deleteRule))
      .toMatchObject({ resource: 'SegmentCouponRule', resourceIdParam: 'id' });
  });

  it('券归因端点：券不存在 → 404 E-COUPON-004', async () => {
    vi.resetAllMocks();
    m.promotionFindUnique.mockResolvedValue(null);
    const service = new SegmentService();
    await expect(service.getCouponAttribution('nope')).rejects.toMatchObject({
      response: { code: 'E-COUPON-004' },
    });
  });
});

// ============================================================================
// D4 归因口径
// ============================================================================

describe('SegmentService.getCouponAttribution — 归因口径（P2-2）', () => {
  it('claimed/redeemed 按层分账；redeemRate=redeemed/claimed；userCount 用全体层人数', async () => {
    vi.resetAllMocks();
    resetSegmentConfigCacheForTest();
    resetProfileThresholdsCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null);
    const service = new SegmentService();
    m.promotionFindUnique.mockResolvedValue({ id: 'promo-1' });
    // 领券用户：2 人（1 ACTIVE 已核销 + 1 NEW 已核销）
    const receivedAt = new Date(Date.now() - 10 * 86_400_000);
    m.queryRaw
      .mockResolvedValueOnce([
        // 领券用户扫描（含 LEFT JOIN 聚合）
        { user_id: 'u-a', f_count: 5n, last_at: ACTIVE_LAST_AT, uc_status: 'USED', received_at: receivedAt },
        { user_id: 'u-b', f_count: 0n, last_at: null, uc_status: 'USED', received_at: receivedAt },
      ])
      .mockResolvedValueOnce([aggRow('u-a', 5, 100, ACTIVE_LAST_AT)]) // 全体扫描
      .mockResolvedValue([{ cnt: 1n }]); // 复购窗口订单数
    m.userCount.mockResolvedValue(2);

    const data = await service.getCouponAttribution('promo-1');
    const byStage = new Map(data.rows.map((r) => [r.stage, r]));
    expect(byStage.get('ACTIVE')!.claimed).toBe(1);
    expect(byStage.get('ACTIVE')!.redeemed).toBe(1);
    expect(byStage.get('ACTIVE')!.redeemRate).toBeCloseTo(1);
    // NEW：f_count=0 → NEW 层
    expect(byStage.get('NEW')!.claimed).toBe(1);
    expect(byStage.get('NEW')!.redeemRate).toBeCloseTo(1);
    // 无领取的层 rate=null
    expect(byStage.get('FIRST_PURCHASE' as LifecycleStage)!.redeemRate).toBeNull();
  });
});
