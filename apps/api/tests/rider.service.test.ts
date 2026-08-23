/**
 * RiderService 单测（聚焦核心业务逻辑）
 *
 * 覆盖：
 *   - apply：创建 PENDING 申请 / 同 userId 已存在 → E-RIDER-002 / idCard 太短 → E-RIDER-003
 *   - review：APPROVED / REJECTED / 已 review 二次 → E-RIDER-004 / 缺 reason → E-RIDER-005
 *   - updateDuty：未 APPROVED → E-RIDER-006 / OFFLINE→ONLINE 状态切换 + Redis SET
 *   - heartbeat：M4 校验 APPROVED
 *   - getProfile：S6 Redis/DB 一致性（status=ONLINE 但 isOnline=false → OFFLINE）
 *
 * mock：db.riderProfile + redis
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    riderProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
  mockRedis: {
    set: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    exists: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { RiderService } from '../src/modules/rider/rider.service';

function buildProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rider-1',
    userId: 'user-1',
    riderName: 'Alice',
    phone: '+670123',
    vehicleType: 'MOTORCYCLE',
    vehiclePlate: 'TD-001',
    status: 'OFFLINE',
    applicationStatus: 'PENDING',
    totalDeliveries: 0,
    rating: { toNumber: () => 5.0 },
    preferredWarehouseIds: [],
    idCardNumber: null,
    reviewedById: null,
    reviewedAt: null,
    rejectReason: null,
    // W3 骑手个人区（2026-08-24）：证件/头像 URL + 配送积分/等级
    avatarUrl: null,
    idCardImageUrl: null,
    licenseImageUrl: null,
    points: 0,
    tier: 'BRONZE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RiderService', () => {
  let service: RiderService;

  beforeEach(() => {
    service = new RiderService();
    Object.values(mockDb.riderProfile).forEach((fn) => fn.mockReset());
    mockRedis.set.mockReset();
    mockRedis.del.mockReset();
    mockRedis.exists.mockReset();
    mockRedis.get.mockReset();
  });

  describe('apply', () => {
    it('同 userId 已有 profile → E-RIDER-002', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      await expect(
        service.apply({
          userId: 'user-1',
          riderName: 'Alice',
          phone: '+670123',
          idCardNumber: '123456',
        }),
      ).rejects.toThrow(/cannot apply twice/);
    });

    it('idCard 太短 → E-RIDER-003', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.apply({
          userId: 'user-1',
          riderName: 'Alice',
          phone: '+670123',
          idCardNumber: '12',
        }),
      ).rejects.toThrow(/idCardNumber required/);
    });

    it('Happy path：创建 PENDING profile', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      mockDb.riderProfile.create.mockResolvedValue(buildProfile());

      const result = await service.apply({
        userId: 'user-1',
        riderName: 'Alice',
        phone: '+670123',
        idCardNumber: '123456789',
      });

      expect(result.applicationStatus).toBe('PENDING');
      expect(mockDb.riderProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            applicationStatus: 'PENDING',
            idCardNumber: '123456789',
          }),
        }),
      );
    });
  });

  describe('review', () => {
    it('profile 不存在 → E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.review({ applicationId: 'r1', reviewerId: 'admin', decision: 'APPROVED' }),
      ).rejects.toThrow(/not found/);
    });

    it('已 review 的 application 二次 review → E-RIDER-004', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      await expect(
        service.review({ applicationId: 'r1', reviewerId: 'admin', decision: 'REJECTED' }),
      ).rejects.toThrow(/already APPROVED/);
    });

    it('REJECTED 但缺 rejectReason → E-RIDER-005', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      await expect(
        service.review({ applicationId: 'r1', reviewerId: 'admin', decision: 'REJECTED' }),
      ).rejects.toThrow(/rejectReason required/);
    });

    it('M6：APPROVED 时保留原 rejectReason（不 nullify）', async () => {
      const profileWithReason = buildProfile({ rejectReason: '历史原因' });
      mockDb.riderProfile.findUnique.mockResolvedValue(profileWithReason);
      mockDb.riderProfile.update.mockResolvedValue(buildProfile({ applicationStatus: 'APPROVED' }));

      await service.review({
        applicationId: 'rider-1',
        reviewerId: 'admin-1',
        decision: 'APPROVED',
      });

      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationStatus: 'APPROVED',
            rejectReason: '历史原因', // 保留原值
          }),
        }),
      );
    });

    it('REJECTED → 写入新 rejectReason', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile({ rejectReason: null }));
      mockDb.riderProfile.update.mockResolvedValue(buildProfile({ applicationStatus: 'REJECTED' }));

      await service.review({
        applicationId: 'rider-1',
        reviewerId: 'admin-1',
        decision: 'REJECTED',
        rejectReason: '身份信息不全',
      });

      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicationStatus: 'REJECTED',
            rejectReason: '身份信息不全',
          }),
        }),
      );
    });
  });

  describe('updateDuty', () => {
    it('profile 不存在 → E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.updateDuty({ riderId: 'u1', status: 'ONLINE' }),
      ).rejects.toThrow(/not found/);
    });

    it('未 APPROVED → E-RIDER-006', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'PENDING' }),
      );
      await expect(
        service.updateDuty({ riderId: 'u1', status: 'ONLINE' }),
      ).rejects.toThrow(/not approved/);
    });

    it('ONLINE：DB 更新 + Redis SET 60s TTL', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      mockDb.riderProfile.update.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', status: 'ONLINE' }),
      );

      const result = await service.updateDuty({
        riderId: 'user-1',
        status: 'ONLINE',
        acceptMode: 'GRAB',
      });

      expect(result.status).toBe('ONLINE');
      expect(result.isOnline).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith('rider:online:user-1', '1', 'EX', 60);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'rider:accept-mode:user-1',
        'GRAB',
        'EX',
        24 * 60 * 60,
      );
    });

    it('OFFLINE：Redis DEL', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', status: 'ONLINE' }),
      );
      mockDb.riderProfile.update.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', status: 'OFFLINE' }),
      );

      await service.updateDuty({ riderId: 'user-1', status: 'OFFLINE' });

      expect(mockRedis.del).toHaveBeenCalledWith('rider:online:user-1');
    });
  });

  describe('heartbeat - M4 修复', () => {
    it('未 APPROVED → renewed=false（不污染在线列表）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'PENDING' }),
      );
      const result = await service.heartbeat('user-1');
      expect(result.renewed).toBe(false);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('profile 不存在 → renewed=false', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      const result = await service.heartbeat('user-1');
      expect(result.renewed).toBe(false);
    });

    it('APPROVED → Redis SET 续期', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.heartbeat('user-1');
      expect(result.renewed).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith('rider:online:user-1', '1', 'EX', 60);
    });
  });

  describe('getProfile - S6 / V2-S3 修复', () => {
    it('DB status=ONLINE 但 Redis TTL 失效 → 强制返回 OFFLINE + 异步 UPDATE DB', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ status: 'ONLINE', applicationStatus: 'APPROVED' }),
      );
      mockRedis.exists.mockResolvedValue(0); // TTL 过期
      mockDb.riderProfile.update.mockResolvedValue({}); // 异步 UPDATE 不阻塞

      const result = await service.getProfile('user-1');
      expect(result.status).toBe('OFFLINE'); // 强制修正
      expect(result.isOnline).toBe(false);

      // V2-S3 修复：异步 UPDATE DB 让 admin 视角也修正
      // 注意：异步触发，需要等微任务
      await new Promise((r) => setTimeout(r, 0));
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: { status: 'OFFLINE' },
        }),
      );
    });

    it('DB status=ONLINE 且 Redis 仍在 → 正常返回 ONLINE', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ status: 'ONLINE', applicationStatus: 'APPROVED', points: 0, tier: 'BRONZE' }),
      );
      mockRedis.exists.mockResolvedValue(1);
      // tier 回写兜底：points=0 → BRONZE，与 DB tier 一致，不触发 update
      mockDb.riderProfile.update.mockResolvedValue({});

      const result = await service.getProfile('user-1');
      expect(result.status).toBe('ONLINE');
      expect(result.isOnline).toBe(true);
      // tier 一致 → 不触发异步 tier 回写；状态一致 → 不触发 status 回写
      expect(mockDb.riderProfile.update).not.toHaveBeenCalled();
    });
  });

  // W3 骑手个人区（2026-08-24）：积分/等级 + 自助改资料
  describe('calcTier - 积分等级计算', () => {
    it('0 分 → BRONZE', async () => {
      const { calcTier } = await import('../src/modules/rider/rider.service');
      expect(calcTier(0)).toBe('BRONZE');
      expect(calcTier(99)).toBe('BRONZE');
    });

    it('100 分 → SILVER', async () => {
      const { calcTier } = await import('../src/modules/rider/rider.service');
      expect(calcTier(100)).toBe('SILVER');
      expect(calcTier(499)).toBe('SILVER');
    });

    it('500 分 → GOLD', async () => {
      const { calcTier } = await import('../src/modules/rider/rider.service');
      expect(calcTier(500)).toBe('GOLD');
      expect(calcTier(1999)).toBe('GOLD');
    });

    it('2000 分 → PLATINUM', async () => {
      const { calcTier } = await import('../src/modules/rider/rider.service');
      expect(calcTier(2000)).toBe('PLATINUM');
      expect(calcTier(99999)).toBe('PLATINUM');
    });
  });

  describe('getProfile - W3 tier 兜底回写', () => {
    it('DB tier 滞后（points=500 但 tier=SILVER）→ 返回 GOLD + 异步回写 tier', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({
          status: 'OFFLINE',
          applicationStatus: 'APPROVED',
          points: 500,
          tier: 'SILVER', // 滞后：应为 GOLD
        }),
      );
      mockRedis.exists.mockResolvedValue(0);
      mockDb.riderProfile.update.mockResolvedValue({});

      const result = await service.getProfile('user-1');
      expect(result.tier).toBe('GOLD'); // calcTier(500) 兜底
      expect(result.points).toBe(500);

      await new Promise((r) => setTimeout(r, 0));
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: { tier: 'GOLD' },
        }),
      );
    });
  });

  describe('updateProfile - W3 骑手自助改资料', () => {
    it('profile 不存在 → E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.updateProfile({ riderId: 'user-1', riderName: 'Bob' }),
      ).rejects.toThrow(/not found/);
    });

    it('未 APPROVED → E-RIDER-006', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'PENDING' }),
      );
      await expect(
        service.updateProfile({ riderId: 'user-1', riderName: 'Bob' }),
      ).rejects.toThrow(/not approved/);
    });

    it('空 body（无字段）→ 直接返回当前 profile，不触发 update', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.updateProfile({ riderId: 'user-1' });
      expect(result.riderName).toBe('Alice');
      expect(mockDb.riderProfile.update).not.toHaveBeenCalled();
    });

    it('改 riderName + avatarUrl → 写入对应字段', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      mockDb.riderProfile.update.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', riderName: 'Bob', avatarUrl: 'http://x/a.jpg' }),
      );
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.updateProfile({
        riderId: 'user-1',
        riderName: 'Bob',
        avatarUrl: 'http://x/a.jpg',
      });
      expect(result.riderName).toBe('Bob');
      expect(result.avatarUrl).toBe('http://x/a.jpg');
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          data: expect.objectContaining({ riderName: 'Bob', avatarUrl: 'http://x/a.jpg' }),
        }),
      );
    });

    it('vehiclePlate 传空串 → 置 null（清除车牌）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      mockDb.riderProfile.update.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', vehiclePlate: null }),
      );
      mockRedis.exists.mockResolvedValue(0);

      await service.updateProfile({ riderId: 'user-1', vehiclePlate: '   ' });
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ vehiclePlate: null }),
        }),
      );
    });

    it('avatarUrl 传 null → 置 null（清除头像）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', avatarUrl: 'http://x/old.jpg' }),
      );
      mockDb.riderProfile.update.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED', avatarUrl: null }),
      );
      mockRedis.exists.mockResolvedValue(0);

      await service.updateProfile({ riderId: 'user-1', avatarUrl: null });
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ avatarUrl: null }),
        }),
      );
    });

    it('idCardNumber 不在 updateProfile 入参（不可改）', async () => {
      // UpdateRiderProfileInput 接口不含 idCardNumber，TS 层保证不可改
      // 此测试固化契约：调用 updateProfile 不应触发 idCardNumber 字段写入
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ applicationStatus: 'APPROVED' }),
      );
      mockDb.riderProfile.update.mockResolvedValue(buildProfile({ applicationStatus: 'APPROVED' }));
      mockRedis.exists.mockResolvedValue(0);

      await service.updateProfile({ riderId: 'user-1', riderName: 'Bob' });
      const call = mockDb.riderProfile.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data).not.toHaveProperty('idCardNumber');
    });
  });
});
