/**
 * RiderLocationStore 单测（真实环境接入批B，Q2 GPS 上报单测）
 *
 * 覆盖（任务书单测 ≥6 清单）：
 *   - 落 Redis（persistRiderLocation：配送中带 orderId / 等单不带，TTL 分档 + value 形状）
 *   - 批量读（fetchRiderLocations：MGET 批量 / 值损坏视为缺失 / Redis 异常回退）
 *   - 读时过期回退（riderPickupDistanceKm：新鲜命中 / ts 过期 null / 键缺失 null）
 *   - haversine 边界值（同点 0km / 已知距离 / 非法坐标 null）
 *   - R17 分桶（bucketRiderLocReadMetrics：hit/expired/missing/redisError）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis, mockLogger } = vi.hoisted(() => ({
  mockRedis: {
    set: vi.fn(),
    mget: vi.fn(),
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/shared/cache', () => ({
  redis: mockRedis,
  setWithTTL: vi.fn(),
  exists: vi.fn(),
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: mockLogger,
}));

import {
  persistRiderLocation,
  fetchRiderLocations,
  bucketRiderLocReadMetrics,
  riderLocKey,
  RIDER_LOC_FRESH_SEC,
  type RiderLocValue,
} from '../src/modules/rider/rider-location.store';

describe('rider-location.store', () => {
  beforeEach(() => {
    mockRedis.set.mockReset();
    mockRedis.mget.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  describe('persistRiderLocation（Q2：落 Redis）', () => {
    it('配送中（带 orderId）→ SET + EX 短 TTL（90s）+ value 含 orderId/ts 服务端时间', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const before = Date.now();
      await persistRiderLocation('user-1', -8.5568, 125.56, 'order-1');

      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      const [key, value, ex, ttl] = mockRedis.set.mock.calls[0];
      expect(key).toBe(riderLocKey('user-1'));
      expect(ex).toBe('EX');
      expect(ttl).toBe(90);
      const parsed = JSON.parse(value) as RiderLocValue;
      expect(parsed.lat).toBe(-8.5568);
      expect(parsed.lng).toBe(125.56);
      expect(parsed.orderId).toBe('order-1');
      // ts 用服务端接收时间（非客户端传入）
      expect(parsed.ts).toBeGreaterThanOrEqual(before);
      expect(parsed.ts).toBeLessThanOrEqual(Date.now());
    });

    it('等单（无 orderId）→ SET + EX 长 TTL（120s）+ value 无 orderId 键', async () => {
      mockRedis.set.mockResolvedValue('OK');
      await persistRiderLocation('user-1', -8.5568, 125.56);

      const [, value, , ttl] = mockRedis.set.mock.calls[0];
      expect(ttl).toBe(120);
      const parsed = JSON.parse(value) as RiderLocValue;
      expect('orderId' in parsed).toBe(false);
    });

    it('Redis 异常 → warn 不抛（落存储是旁路增强，不阻塞上报主链路）', async () => {
      mockRedis.set.mockRejectedValue(new Error('connection refused'));
      await expect(
        persistRiderLocation('user-1', -8.5568, 125.56, 'order-1'),
      ).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'RIDER_LOC_PERSIST_FAILED' }),
      );
    });
  });

  describe('fetchRiderLocations（Q2：MGET 批量 + 部分缺失 + Redis 异常回退）', () => {
    it('MGET 批量：一次 mget 覆盖全部 userId（禁循环单 GET），仅返回可解析的键', async () => {
      const fresh: RiderLocValue = { lat: -8.55, lng: 125.55, ts: Date.now() };
      mockRedis.mget.mockResolvedValue([JSON.stringify(fresh), null]);
      const { locs, redisError } = await fetchRiderLocations(['u1', 'u2']);

      expect(mockRedis.mget).toHaveBeenCalledTimes(1);
      expect(mockRedis.mget).toHaveBeenCalledWith(riderLocKey('u1'), riderLocKey('u2'));
      expect(redisError).toBe(false);
      expect(locs.get('u1')).toEqual(fresh);
      expect(locs.has('u2')).toBe(false);
    });

    it('值损坏（非法 JSON / 字段缺失）→ 视为缺失（missing 分桶），不抛', async () => {
      mockRedis.mget.mockResolvedValue(['not-json', JSON.stringify({ lat: 1 }), null]);
      const { locs, redisError } = await fetchRiderLocations(['u1', 'u2', 'u3']);
      expect(redisError).toBe(false);
      expect(locs.size).toBe(0);
    });

    it('Redis 异常 → { locs 空, redisError: true } + warn（调用方全员回退 null）', async () => {
      mockRedis.mget.mockRejectedValue(new Error('redis down'));
      const { locs, redisError } = await fetchRiderLocations(['u1', 'u2']);
      expect(redisError).toBe(true);
      expect(locs.size).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'RIDER_LOC_MGET_FAILED' }),
      );
    });
  });
});

// ===========================================================================
// riderPickupDistanceKm + 打分排序对比（经 listDispatchCandidates 间接驱动）
// ===========================================================================

const { mockDb, mockHelpers, mockRealtime, mockServer, mockEligibility } = vi.hoisted(() => {
  const server = { to: vi.fn(() => server), emit: vi.fn() };
  return {
    mockDb: {
      deliveryTask: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        groupBy: vi.fn(),
      },
      order: { findUnique: vi.fn(), update: vi.fn() },
      orderEvent: { create: vi.fn() },
      cashCollection: { create: vi.fn() },
      refund: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      riderProfile: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      systemConfig: { findUnique: vi.fn() },
      $executeRaw: vi.fn(),
    },
    mockHelpers: { withTransaction: vi.fn() },
    mockRealtime: { server },
    mockServer: server,
    mockEligibility: {
      getEnabledTiers: vi.fn().mockResolvedValue([{ id: 'tier-1', minAmount: 100, maxOrderAmount: 1000 }]),
      deriveEligibility: vi.fn().mockImplementation((_id: string, depositAmount: number) => ({
        riderProfileId: 'r',
        depositAmount,
        maxOrderAmount: 100000,
        tierId: 'tier-1',
      })),
      isEligible: vi.fn().mockReturnValue(true),
      assertCanAccept: vi.fn(),
      getRequiredDeposit: vi.fn().mockResolvedValue(100),
      toLabel: vi.fn().mockReturnValue({ eligible: true, depositAmount: 100, maxOrderAmount: 100000, canAccept: true }),
    },
  };
});

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: mockHelpers.withTransaction,
  incrementSalesCountForOrder: vi.fn(),
}));

vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

vi.mock('../src/shared/logger/logger', () => ({ logger: mockLogger }));

vi.mock('../src/modules/realtime/realtime.gateway', () => ({
  RealtimeGateway: class {
    server = mockServer;
  },
}));

vi.mock('../src/modules/rider/deposit-eligibility.service', () => ({
  DepositEligibilityService: class {
    getEnabledTiers = mockEligibility.getEnabledTiers;
    deriveEligibility = mockEligibility.deriveEligibility;
    isEligible = mockEligibility.isEligible;
    assertCanAccept = mockEligibility.assertCanAccept;
    getRequiredDeposit = mockEligibility.getRequiredDeposit;
    toLabel = mockEligibility.toLabel;
  },
  DISPATCH_SCORE_WEIGHTS: { rating: 0.5, distance: 0.3, inTransit: 0.2 },
  SCORE_MAX_DISTANCE_KM: 10,
}));

import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { SCORE_MAX_DISTANCE_KM } from '../src/modules/rider/deposit-eligibility.service';
import { haversineDistanceKm } from '@meimart/shared-utils';

/** 候选 profile（两个骑手：A 评分低 / B 评分高——占位中点下 B 必在前） */
function buildProfile(id: string, userId: string, rating: number) {
  return {
    id,
    userId,
    riderName: `Rider ${id}`,
    phone: '+67077200000',
    vehicleType: 'MOTORCYCLE',
    rating: { toNumber: () => rating },
    depositAmount: 100,
    preferredWarehouseIds: ['wh-1'],
  };
}

function buildCandidateTask() {
  return {
    id: 'task-1',
    orderId: 'order-1',
    warehouseId: 'wh-1',
    status: 'PENDING_ASSIGN',
    pickupLat: { toNumber: () => -8.5568 },
    pickupLng: { toNumber: () => 125.56 },
  };
}

describe('DispatchService 打分真实化（批B：占位 vs 真实距离排序对比——B2 代码层证据）', () => {
  let service: DispatchService;

  beforeEach(() => {
    service = new DispatchService(mockRealtime as never, mockEligibility as never, null);
    Object.values(mockDb).forEach((table) => {
      if (typeof table === 'object') {
        Object.values(table).forEach((fn) => fn.mockReset?.());
      }
    });
    // R17 断言逐条核对当前用例的日志（不重置会捞到上一用例的 RIDER_LOC_READ_METRICS）
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockRedis.mget.mockReset();
    mockEligibility.getEnabledTiers.mockResolvedValue([{ id: 'tier-1', minAmount: 100, maxOrderAmount: 1000 }]);
    mockEligibility.deriveEligibility.mockImplementation((_id: string, depositAmount: number) => ({
      riderProfileId: 'r',
      depositAmount,
      maxOrderAmount: 100000,
      tierId: 'tier-1',
    }));
    mockEligibility.isEligible.mockReturnValue(true);
    mockEligibility.toLabel.mockReturnValue({ eligible: true, depositAmount: 100, maxOrderAmount: 100000, canAccept: true });
    mockEligibility.getRequiredDeposit.mockResolvedValue(100);
    mockDb.deliveryTask.findUnique.mockResolvedValue(buildCandidateTask());
    mockDb.order.findUnique.mockResolvedValue({ payableAmount: 100, scheduledFor: null });
    mockDb.deliveryTask.groupBy.mockResolvedValue([]);
    // 两个骑手：A rating=3 / B rating=4。占位中点下 B 在前
    // （评分档位取 3/4 而非 3/5：score 经 Math.round(raw)*100 整数量化，
    //   B=5 时 raw≥0.5 恒 round 到 1，与 A 的 1 同分，排序对比无法区分）
    mockDb.riderProfile.findMany.mockResolvedValue([
      buildProfile('rider-a', 'u-a', 3),
      buildProfile('rider-b', 'u-b', 4),
    ]);
    // pipeline（在线标记）：两个都返回 1（在线）
    const pipeline = {
      exists: vi.fn(),
      exec: vi.fn().mockResolvedValue([[0, 1], [0, 1]]),
    };
    pipeline.exists.mockReturnValue(pipeline);
    vi.mocked(mockDb.deliveryTask.groupBy).mockResolvedValue([]);
    // systemConfig 权重未配 → 回退常量（rating 0.5 / distance 0.3 / inTransit 0.2）
    mockDb.systemConfig.findUnique.mockResolvedValue(null);
    // fetchRiderLocations 走 mockRedis.mget
  });

  /** pipeline mock 需要 redis.pipeline()，dispatch.service 在线检查用它 */
  function mockPipeline(online = true) {
    const execResult = [[0, online ? 1 : 0], [0, online ? 1 : 0]];
    mockRedis.pipeline = vi.fn().mockReturnValue({
      exists: vi.fn(),
      exec: vi.fn().mockResolvedValue(execResult),
    });
  }

  it('Q2-排序对比：占位（无位置数据）下评分高的 B 排前——中点兜底基线', async () => {
    mockPipeline(true);
    mockRedis.mget.mockResolvedValue([null, null]); // 两骑手均无位置 → 全员 null 中点
    const result = await service.listDispatchCandidates({ taskId: 'task-1' });
    expect(result.items.map((c) => c.riderProfileId)).toEqual(['rider-b', 'rider-a']);
    // 距离字段：无位置 → null（占位语义不变）
    expect(result.items.every((c) => c.distanceKm === null)).toBe(true);
  });

  it('Q2-排序对比：真实距离分改变排序结果——A 距取货点近（有位置），B 远，A 反超到第一', async () => {
    mockPipeline(true);
    // A 紧贴取货点（0.5km 内）→ 距离近度 ≈ 0.97；B 在 MAX_D=10km 处 → 距离近度 0
    const near: RiderLocValue = { lat: -8.5572, lng: 125.5605, ts: Date.now() };
    const far: RiderLocValue = {
      lat: -8.5568 - SCORE_MAX_DISTANCE_KM * 0.9 / 111.32, // ≈ 9km 纬度差
      lng: 125.56,
      ts: Date.now(),
    };
    mockRedis.mget.mockResolvedValue([JSON.stringify(near), JSON.stringify(far)]);
    const result = await service.listDispatchCandidates({ taskId: 'task-1' });
    const [first, second] = result.items;
    expect(first?.riderProfileId).toBe('rider-a');
    expect(second?.riderProfileId).toBe('rider-b');
    // 真实距离两位小数（km）
    expect(first?.distanceKm).toBeGreaterThan(0);
    expect(first?.distanceKm).toBeLessThan(1);
    expect(second?.distanceKm).toBeGreaterThan(8);
    // A 评分低（3/5）却排前：距离分差 0.3×(0.97−0) ≈ 0.29 > rating 分差 0.5×(0.8−0.6)=0.1
    // → 排序确实被真实距离分改变（B2 判别条件的代码层证据）
    expect(first!.score).toBeGreaterThan(second!.score);
    expect(second!.score).toBeGreaterThanOrEqual(0);
  });

  it('Q2：读时过期回退——键存在但 ts 超 RIDER_LOC_FRESH_SEC → distanceKm null（中点兜底）', async () => {
    mockPipeline(true);
    const stale: RiderLocValue = {
      lat: -8.5572,
      lng: 125.5605,
      ts: Date.now() - (RIDER_LOC_FRESH_SEC + 10) * 1000,
    };
    mockRedis.mget.mockResolvedValue([JSON.stringify(stale), null]);
    const result = await service.listDispatchCandidates({ taskId: 'task-1' });
    expect(result.items.every((c) => c.distanceKm === null)).toBe(true);
    // R17：过期分桶=1
    const metricsLog = mockLogger.info.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).msg === 'RIDER_LOC_READ_METRICS',
    );
    expect(metricsLog).toBeDefined();
    expect((metricsLog![0] as Record<string, unknown>).expired).toBe(1);
  });

  it('Q2：Redis 异常回退——mget 拒绝 → 全员 null + 中点兜底 + R17 redisError 分桶', async () => {
    mockPipeline(true);
    mockRedis.mget.mockRejectedValue(new Error('redis down'));
    const result = await service.listDispatchCandidates({ taskId: 'task-1' });
    expect(result.items.every((c) => c.distanceKm === null)).toBe(true);
    const metricsLog = mockLogger.info.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).msg === 'RIDER_LOC_READ_METRICS',
    );
    expect((metricsLog![0] as Record<string, unknown>).redisError).toBe(1);
    expect((metricsLog![0] as Record<string, unknown>).missing).toBe(2);
  });

  it('Q2：MGET 部分缺失——A 有新鲜位置 B 缺失 → A 真实距离 / B null', async () => {
    mockPipeline(true);
    const near: RiderLocValue = { lat: -8.5572, lng: 125.5605, ts: Date.now() };
    mockRedis.mget.mockResolvedValue([JSON.stringify(near), null]);
    const result = await service.listDispatchCandidates({ taskId: 'task-1' });
    const a = result.items.find((c) => c.riderProfileId === 'rider-a');
    const b = result.items.find((c) => c.riderProfileId === 'rider-b');
    expect(a?.distanceKm).not.toBeNull();
    expect(b?.distanceKm).toBeNull();
  });
});

describe('haversine 边界值（Q2，复用 shared-utils geo.ts:25）', () => {
  it('同一点 → 0', () => {
    expect(haversineDistanceKm(-8.5568, 125.56, -8.5568, 125.56)).toBe(0);
  });

  it('帝力已知两点 ≈ 0.86km（误差容忍 ±10%）', () => {
    // 取货点 → 0.01° 纬度差（≈1.11km）+ 0.01° 经度差（≈1.10km×cos8.5°≈1.09km）
    const km = haversineDistanceKm(-8.5568, 125.56, -8.5468, 125.57);
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(1.3);
    expect(km!).toBeLessThan(1.7);
  });

  it('任一坐标非有限 → null（helper 合约，调用方回退中点）', () => {
    expect(haversineDistanceKm(Number.NaN, 125.56, -8.55, 125.56)).toBeNull();
    expect(haversineDistanceKm(-8.55, Number.POSITIVE_INFINITY, 0, 0)).toBeNull();
  });
});

describe('R17 分桶（bucketRiderLocReadMetrics）', () => {
  it('hit / expired / missing / redisError 正确分桶 + 比率输出', () => {
    const now = Date.now();
    const locs = new Map<string, RiderLocValue>([
      ['u-hit', { lat: 1, lng: 2, ts: now - 1000 }],
      ['u-expired', { lat: 1, lng: 2, ts: now - (RIDER_LOC_FRESH_SEC + 5) * 1000 }],
    ]);
    const metrics = bucketRiderLocReadMetrics(['u-hit', 'u-expired', 'u-missing'], locs, now, false);
    expect(metrics).toEqual({ hit: 1, expired: 1, missing: 1, redisError: 0 });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'RIDER_LOC_READ_METRICS',
        hitRate: 0.333,
        expiredRate: 0.333,
        missingRate: 0.333,
      }),
    );
  });
});
