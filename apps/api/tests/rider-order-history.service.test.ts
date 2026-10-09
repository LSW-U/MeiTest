/**
 * RiderOrderHistoryService 单测 — 批1 P1 + 批2 P2（方案v2-20261009，R12 互斥口径）
 *
 * 覆盖场景：
 *   1. R12 互斥口径：Order CANCELLED 优先（DELIVERED+取消 → cancelled 而非 completed）；
 *      FAILED+取消 → cancelled 而非 transferred；FAILED 未取消 → transferred；
 *      DELIVERED 未取消 → completed；all = 三者之和（A3）
 *   2. 详情：字段派生（income=deliveryFee / completedAt epoch ms / durationMinutes 缺失给 0 /
 *      dropoffName=deliveryAddress.name / pickupName=name.en 回退 code / distanceKm Haversine→breakdown→0）
 *   3. 归属校验：他人任务 / 不存在 / 非历史范围（进行中）→ 404 E-RIDER-001；无 profile → 403
 *   4. 批1 getHistory：三态全查 where / 派生后过滤（status 参数非 Prisma 枚举）/
 *      completedAt 倒序 / offset 分页 total / 空态（A1 契约层）
 *   5. 批1 getTodayStats：只算 completed（DELIVERED+订单未取消）/ deliveredAt 落 Dili 当日 /
 *      count 与 totalIncome 同口径 / 时区走 MARKET_TIMEZONE helper（A2）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('../src/shared/db', () => {
  const profileFindUnique = vi.fn();
  const deliveryTaskFindMany = vi.fn();
  const deliveryTaskFindFirst = vi.fn();
  const db = {
    riderProfile: { findUnique: profileFindUnique },
    deliveryTask: { findMany: deliveryTaskFindMany, findFirst: deliveryTaskFindFirst },
  };
  return { db, withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
});

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RiderOrderHistoryService } from '../src/modules/rider/order-history.service';
import { db } from '../src/shared/db';

const profileFindUnique = db.riderProfile.findUnique as unknown as ReturnType<typeof vi.fn>;
const taskFindMany = db.deliveryTask.findMany as unknown as ReturnType<typeof vi.fn>;
const taskFindFirst = db.deliveryTask.findFirst as unknown as ReturnType<typeof vi.fn>;

const SUB = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

function service() {
  return new RiderOrderHistoryService();
}

beforeEach(() => {
  vi.clearAllMocks();
  profileFindUnique.mockResolvedValue({ id: PROFILE_ID, userId: SUB });
  taskFindMany.mockResolvedValue([]);
  taskFindFirst.mockResolvedValue(null);
});

describe('RiderOrderHistoryService.getStatusCounts — R12 互斥口径（A3）', () => {
  it('四态样本：CANCELLED 优先双命中，all = 三者之和', async () => {
    taskFindMany.mockResolvedValue([
      { status: 'DELIVERED', order: { status: 'CONFIRMED' } }, // completed
      { status: 'DELIVERED', order: { status: 'CANCELLED' } }, // cancelled（优先，不计 completed）
      { status: 'FAILED', order: { status: 'CANCELLED' } }, // cancelled（优先，不计 transferred）
      { status: 'FAILED', order: { status: 'CONFIRMED' } }, // transferred
      { status: 'ASSIGNED', order: { status: 'CANCELLED' } }, // cancelled（订单取消优先于非终态）
      { status: 'ASSIGNED', order: { status: 'CONFIRMED' } }, // 非历史范围，不计
    ]);
    const r = await service().getStatusCounts(SUB);
    expect(r).toEqual({ all: 5, completed: 1, cancelled: 3, transferred: 1 });
    expect(r.all).toBe(r.completed + r.cancelled + r.transferred);
  });

  it('实测口径回归：99 FAILED 全关联 CANCELLED → transferred=0 属预期', async () => {
    taskFindMany.mockResolvedValue(
      Array.from({ length: 99 }, () => ({ status: 'FAILED', order: { status: 'CANCELLED' } })),
    );
    const r = await service().getStatusCounts(SUB);
    expect(r.transferred).toBe(0);
    expect(r.cancelled).toBe(99);
    expect(r.all).toBe(99);
  });

  it('where 条件走三态全查（DELIVERED/FAILED/关联订单 CANCELLED）', async () => {
    await service().getStatusCounts(SUB);
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          riderId: PROFILE_ID,
          OR: [{ status: 'DELIVERED' }, { status: 'FAILED' }, { order: { status: 'CANCELLED' } }],
        },
      }),
    );
  });

  it('空态：新骑手全 0（data 不为 null）', async () => {
    const r = await service().getStatusCounts(SUB);
    expect(r).toEqual({ all: 0, completed: 0, cancelled: 0, transferred: 0 });
  });
});

describe('RiderOrderHistoryService.getDetail — 字段派生（A4）', () => {
  const base = {
    id: 'task-1',
    status: 'DELIVERED',
    riderId: PROFILE_ID,
    pickupAddress: 'Rua 15 de Outubro, Dili',
    pickupLat: -8.5569,
    pickupLng: 125.5603,
    dropoffAddress: 'Avenida Marechal Carmona, Dili',
    dropoffLat: -8.5581,
    dropoffLng: 125.5612,
    pickedUpAt: new Date('2026-10-01T02:00:00Z'),
    deliveredAt: new Date('2026-10-01T02:28:00Z'),
    updatedAt: new Date('2026-10-01T02:28:00Z'),
    order: {
      orderNo: 'MM202610010001',
      status: 'CONFIRMED',
      deliveryFee: 900,
      deliveryAddress: { name: 'Hotel Timor', phone: '+670123', detail: 'Dili', lat: -8.5581, lng: 125.5612 },
      deliveryFeeBreakdown: { baseFee: 500, distanceFee: 400, distanceKm: 4.2 },
    },
    warehouse: { code: 'W01', name: { en: 'Heritage Warehouse Dili', zh: '帝力仓' } },
  };

  it('completed：completedAt=deliveredAt epoch ms；durationMinutes=28；income=deliveryFee 分', async () => {
    taskFindFirst.mockResolvedValue(base);
    const r = await service().getDetail(SUB, 'task-1');
    expect(r.status).toBe('completed');
    expect(r.completedAt).toBe(new Date('2026-10-01T02:28:00Z').getTime());
    expect(r.durationMinutes).toBe(28);
    expect(r.income).toBe(900);
    expect(r.orderNo).toBe('MM202610010001');
    expect(r.dropoffName).toBe('Hotel Timor');
    expect(r.pickupName).toBe('Heritage Warehouse Dili');
    expect(r.distanceKm).toBeGreaterThan(0);
  });

  it('cancelled：completedAt=updatedAt', async () => {
    taskFindFirst.mockResolvedValue({
      ...base,
      status: 'FAILED',
      order: { ...base.order, status: 'CANCELLED' },
      updatedAt: new Date('2026-10-02T03:00:00Z'),
    });
    const r = await service().getDetail(SUB, 'task-1');
    expect(r.status).toBe('cancelled');
    expect(r.completedAt).toBe(new Date('2026-10-02T03:00:00Z').getTime());
  });

  it('durationMinutes 缺失（pickedUpAt/deliveredAt null）→ 0', async () => {
    taskFindFirst.mockResolvedValue({ ...base, pickedUpAt: null, deliveredAt: null });
    const r = await service().getDetail(SUB, 'task-1');
    expect(r.durationMinutes).toBe(0);
  });

  it('distanceKm 降级链：坐标哨兵 (0,0) → breakdown.distanceKm；再缺失 → 0', async () => {
    taskFindFirst.mockResolvedValue({ ...base, pickupLat: 0, pickupLng: 0, dropoffLat: 0, dropoffLng: 0 });
    expect((await service().getDetail(SUB, 'task-1')).distanceKm).toBe(4.2);
    taskFindFirst.mockResolvedValue({
      ...base,
      pickupLat: 0, pickupLng: 0, dropoffLat: 0, dropoffLng: 0,
      order: { ...base.order, deliveryFeeBreakdown: null },
    });
    expect((await service().getDetail(SUB, 'task-1')).distanceKm).toBe(0);
  });

  it('pickupName 回退链：name.en 缺失 → code；warehouse null → 空串', async () => {
    taskFindFirst.mockResolvedValue({ ...base, warehouse: { code: 'W01', name: {} } });
    expect((await service().getDetail(SUB, 'task-1')).pickupName).toBe('W01');
    taskFindFirst.mockResolvedValue({ ...base, warehouse: null });
    expect((await service().getDetail(SUB, 'task-1')).pickupName).toBe('');
  });

  it('deliveryAddress 缺 name（历史快照）→ dropoffName 空串不炸', async () => {
    taskFindFirst.mockResolvedValue({
      ...base,
      order: { ...base.order, deliveryAddress: null },
    });
    expect((await service().getDetail(SUB, 'task-1')).dropoffName).toBe('');
  });
});

describe('RiderOrderHistoryService — 鉴权与归属（A5）', () => {
  it('RIDER JWT 无 profile → 403 E-RIDER-001', async () => {
    profileFindUnique.mockResolvedValue(null);
    await expect(service().getStatusCounts(SUB)).rejects.toThrow(ForbiddenException);
    await expect(service().getDetail(SUB, 'task-1')).rejects.toThrow(ForbiddenException);
  });

  it('他人任务 / 不存在 → 404 E-RIDER-001（findFirst 带 riderId 条件，不泄露存在性）', async () => {
    taskFindFirst.mockResolvedValue(null);
    await expect(service().getDetail(SUB, 'task-1')).rejects.toThrow(NotFoundException);
    await expect(service().getDetail(SUB, 'task-1')).rejects.toMatchObject({
      response: { code: 'E-RIDER-001' },
    });
    expect(taskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1', riderId: PROFILE_ID } }),
    );
  });

  it('非历史范围（进行中且订单未取消）→ 404', async () => {
    taskFindFirst.mockResolvedValue({
      id: 'task-1',
      status: 'ASSIGNED',
      riderId: PROFILE_ID,
      pickupAddress: 'x', pickupLat: 0, pickupLng: 0, dropoffAddress: 'y', dropoffLat: 0, dropoffLng: 0,
      pickedUpAt: null, deliveredAt: null, updatedAt: new Date(),
      order: { orderNo: 'X', status: 'CONFIRMED', deliveryFee: 0, deliveryAddress: null, deliveryFeeBreakdown: null },
      warehouse: null,
    });
    await expect(service().getDetail(SUB, 'task-1')).rejects.toThrow(NotFoundException);
  });
});

// ============================================================================
// 批1 P1：getHistory（§2.1 列表）+ getTodayStats（§2.3 今日统计）
// ============================================================================

describe('RiderOrderHistoryService.getHistory — 批1 A1 契约层', () => {
  /** 与 getDetail 字段派生样本同构（含 warehouse/deliveryAddress 全量） */
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'task-1',
    status: 'DELIVERED',
    riderId: PROFILE_ID,
    pickupAddress: 'Rua 15 de Outubro, Dili',
    pickupLat: -8.5569,
    pickupLng: 125.5603,
    dropoffAddress: 'Avenida Marechal Carmona, Dili',
    dropoffLat: -8.5581,
    dropoffLng: 125.5612,
    pickedUpAt: new Date('2026-10-01T02:00:00Z'),
    deliveredAt: new Date('2026-10-01T02:28:00Z'),
    updatedAt: new Date('2026-10-01T02:28:00Z'),
    order: {
      orderNo: 'MM202610010001',
      status: 'CONFIRMED',
      deliveryFee: 900,
      deliveryAddress: { name: 'Hotel Timor', phone: '+670123', detail: 'Dili', lat: -8.5581, lng: 125.5612 },
      deliveryFeeBreakdown: { baseFee: 500, distanceFee: 400, distanceKm: 4.2 },
    },
    warehouse: { code: 'W01', name: { en: 'Heritage Warehouse Dili' } },
    ...over,
  });

  it('三态全查 where（DELIVERED/FAILED/关联订单 CANCELLED）+ include 派生所需字段', async () => {
    await service().getHistory(SUB, { page: 1, pageSize: 20 });
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          riderId: PROFILE_ID,
          OR: [{ status: 'DELIVERED' }, { status: 'FAILED' }, { order: { status: 'CANCELLED' } }],
        },
      }),
    );
  });

  it('分页：total=全集（过滤后），items=当前页切片；page/pageSize 回显', async () => {
    // 25 条 completed，pageSize=10 → 第 2 页 10 条，total=25
    taskFindMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) =>
        row({ id: `task-${i}`, deliveredAt: new Date(Date.now() - i * 60_000) }),
      ),
    );
    const r = await service().getHistory(SUB, { page: 2, pageSize: 10 });
    expect(r.total).toBe(25);
    expect(r.items).toHaveLength(10);
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(10);
  });

  it('status 参数过滤在派生映射后做：cancelled 查询不返回 DELIVERED 未取消行（不透传 Prisma 枚举）', async () => {
    taskFindMany.mockResolvedValue([
      row({ id: 'a', status: 'DELIVERED' }), // completed
      row({ id: 'b', status: 'FAILED', order: { orderNo: 'B', status: 'CANCELLED', deliveryFee: 0, deliveryAddress: null, deliveryFeeBreakdown: null } }), // cancelled
      row({ id: 'c', status: 'FAILED' }), // transferred
    ]);
    const cancelled = await service().getHistory(SUB, { page: 1, pageSize: 20, status: 'cancelled' });
    expect(cancelled.total).toBe(1);
    expect(cancelled.items[0].id).toBe('b');
    const transferred = await service().getHistory(SUB, { page: 1, pageSize: 20, status: 'transferred' });
    expect(transferred.total).toBe(1);
    expect(transferred.items[0].id).toBe('c');
  });

  it('completedAt 倒序：completed 按 deliveredAt，cancelled/transferred 按 updatedAt', async () => {
    taskFindMany.mockResolvedValue([
      row({ id: 'old', deliveredAt: new Date('2026-10-01T02:00:00Z') }),
      row({ id: 'new', deliveredAt: new Date('2026-10-02T02:00:00Z') }),
      row({
        id: 'cancel',
        status: 'FAILED',
        deliveredAt: null,
        updatedAt: new Date('2026-10-03T00:00:00Z'),
        order: { orderNo: 'C', status: 'CANCELLED', deliveryFee: 0, deliveryAddress: null, deliveryFeeBreakdown: null },
      }),
    ]);
    const r = await service().getHistory(SUB, { page: 1, pageSize: 20 });
    expect(r.items.map((i) => i.id)).toEqual(['cancel', 'new', 'old']);
  });

  it('空态：新骑手 items=[] total=0（data 不为 null）', async () => {
    const r = await service().getHistory(SUB, { page: 1, pageSize: 20 });
    expect(r).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('RIDER JWT 无 profile → 403', async () => {
    profileFindUnique.mockResolvedValue(null);
    await expect(service().getHistory(SUB, { page: 1, pageSize: 20 })).rejects.toThrow(ForbiddenException);
  });
});

describe('RiderOrderHistoryService.getTodayStats — 批1 A2', () => {
  it('只算 completed：DELIVERED + 订单未取消（order.status not CANCELLED）', async () => {
    await service().getTodayStats(SUB);
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          riderId: PROFILE_ID,
          status: 'DELIVERED',
          order: { status: { not: 'CANCELLED' } },
        }),
      }),
    );
  });

  it('deliveredAt 边界 = Dili 当日 [00:00, +24h)（MARKET_TIMEZONE helper，非手写 offset）', async () => {
    // Dili = UTC+9：Dili 今日日期字符串 → 构造的 gte 是 UTC 午夜墙上时间
    await service().getTodayStats(SUB);
    const where = taskFindMany.mock.calls[0][0].where as { deliveredAt: { gte: Date; lt: Date } };
    const { gte, lt } = where.deliveredAt;
    // gte = 'YYYY-MM-DDT00:00:00.000Z'（Dili 日期 + UTC 午夜，earnings.service diliDateN 同款）
    expect(gte.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    // 上界 = gte + 24h（Dili 无夏令时）
    expect(lt.getTime() - gte.getTime()).toBe(24 * 3600 * 1000);
    // gte 日期 = getDaysAgoInTz(0)（Dili 当日）——与 helper 输出一致
    const { getDaysAgoInTz, MARKET_TIMEZONE } = await import('../src/shared/datetime');
    expect(gte.toISOString().slice(0, 10)).toBe(getDaysAgoInTz(0, MARKET_TIMEZONE));
  });

  it('count 与 totalIncome 同口径：同一次查询求和（Σ deliveryFee 分）', async () => {
    taskFindMany.mockResolvedValue([
      { order: { deliveryFee: 900 } },
      { order: { deliveryFee: 5400 } },
      { order: null },
    ]);
    const r = await service().getTodayStats(SUB);
    expect(r.count).toBe(3);
    expect(r.totalIncome).toBe(6300);
  });

  it('空态：0 单 → { count: 0, totalIncome: 0 }', async () => {
    const r = await service().getTodayStats(SUB);
    expect(r).toEqual({ count: 0, totalIncome: 0 });
  });

  it('RIDER JWT 无 profile → 403', async () => {
    profileFindUnique.mockResolvedValue(null);
    await expect(service().getTodayStats(SUB)).rejects.toThrow(ForbiddenException);
  });
});
