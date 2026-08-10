/**
 * DispatchService Admin 单测（批次 4，2026-08-10）
 *
 * 覆盖 reassign/cancel 的事务编排（核心风险点，复用 acceptTask 乐观锁模式）：
 *   1. reassign 成功：事务内 $executeRaw UPDATE WHERE ASSIGNED + order.update riderId 同事务 + note 追加
 *   2. reassign 非 ASSIGNED → E-DISPATCH-006（第一期只 ASSIGNED）
 *   3. reassign 新骑手非 APPROVED → E-DISPATCH-008
 *   4. reassign 并发（$executeRaw 返回 0）→ E-DISPATCH-006
 *   5. cancel 成功：事务内 $executeRaw UPDATE WHERE IN(...) + order.update riderId=null
 *   6. cancel 状态不允许 → E-DISPATCH-007
 *
 * mock：db.deliveryTask.findUnique / db.riderProfile.findUnique / withTransaction（执行 fn 传 fake tx）/
 *       tx.$executeRaw / tx.order.update / redis.exists（checkRiderOnline，reassign 不触发）
 *
 * controller 装配由 admin-dispatch.controller.test.ts 覆盖
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockWithTransaction, mockTx, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    deliveryTask: { findUnique: vi.fn() },
    riderProfile: { findUnique: vi.fn(), findMany: vi.fn() },
  },
  mockWithTransaction: vi.fn(),
  mockTx: {
    $executeRaw: vi.fn(),
    order: { update: vi.fn() },
  } as unknown as import('../src/shared/db').Tx,
  mockRedis: {
    pipeline: vi.fn().mockReturnValue({
      exists: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: mockWithTransaction,
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/modules/realtime/realtime.gateway', () => ({
  RealtimeGateway: class {
    server = { to: () => ({ emit: vi.fn() }) };
  },
}));

import { DispatchService } from '../src/modules/dispatch/dispatch.service';

/** 完整 mock task（reassignTask 第一次读子集 + getAdminDetail 读全部，同一 mock 兼容） */
const mockTaskComplete = {
  id: 't-1',
  orderId: 'o-1',
  riderId: 'r-old',
  warehouseId: 'w-1',
  status: 'ASSIGNED',
  pickupAddress: 'warehouse',
  pickupLat: 0,
  pickupLng: 0,
  dropoffAddress: 'customer',
  dropoffLat: 0,
  dropoffLng: 0,
  assignedAt: new Date(),
  pickedUpAt: null,
  deliveredAt: null,
  estimatedArrival: null,
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  order: {
    orderNo: 'MM20260810W01000001',
    status: 'OUT_FOR_DELIVERY',
    payableAmount: 5800,
    paymentMethod: 'COD',
  },
  rider: { id: 'r-old', riderName: 'Old Rider', phone: '123' },
  warehouse: { code: 'W01' },
};

describe('DispatchService.reassignTask + cancelTask（批次 4 事务编排）', () => {
  let service: DispatchService;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 withTransaction：执行 fn 传 mockTx（fn 内抛错则 withTransaction 抛错，模拟真实回滚）
    mockWithTransaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
    // 默认 findUnique 返回完整 task（ASSIGNED）
    mockDb.deliveryTask.findUnique.mockResolvedValue(mockTaskComplete);
    service = new DispatchService(undefined as never);
  });

  it('reassign 成功：事务内 $executeRaw UPDATE WHERE ASSIGNED + order.update riderId 同事务 + note 追加', async () => {
    mockDb.riderProfile.findUnique.mockResolvedValue({
      id: 'r-new',
      applicationStatus: 'APPROVED',
      riderName: 'New Rider',
    });
    mockTx.$executeRaw.mockResolvedValue(1); // updated = 1
    mockTx.order.update.mockResolvedValue({});

    const result = await service.reassignTask({
      taskId: 't-1',
      newRiderId: 'r-new',
      adminUserId: 'admin-1',
      reason: 'off-duty',
    });

    // 事务内：乐观锁 UPDATE + order.update（同事务原子）
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockTx.order.update).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { riderId: 'r-new' },
    });
    // note 追加改派记录：$executeRaw 用 tagged template，[reassign] 在参数 values 里（不在 SQL strings）
    const reassignArgs = (mockTx.$executeRaw.mock.calls[0] as unknown[]).flat();
    expect(
      reassignArgs.some((a) => typeof a === 'string' && a.includes('[reassign]')),
    ).toBe(true);
    // 返回 admin view（getAdminDetail）
    expect(result.id).toBe('t-1');
    expect(result.riderId).toBe('r-old'); // mockTaskComplete 的 riderId（实际 DB 已改，mock 不反映）
  });

  it('reassign 非 ASSIGNED → E-DISPATCH-006（第一期只 ASSIGNED）', async () => {
    mockDb.deliveryTask.findUnique.mockResolvedValue({ ...mockTaskComplete, status: 'PICKED_UP' });

    await expect(
      service.reassignTask({
        taskId: 't-1',
        newRiderId: 'r-new',
        adminUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'E-DISPATCH-006' },
    });

    // 状态校验在事务前，事务未启动
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });

  it('reassign 新骑手非 APPROVED → E-DISPATCH-008', async () => {
    mockDb.riderProfile.findUnique.mockResolvedValue({
      id: 'r-new',
      applicationStatus: 'PENDING', // 未审核
      riderName: 'New',
    });

    await expect(
      service.reassignTask({
        taskId: 't-1',
        newRiderId: 'r-new',
        adminUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'E-DISPATCH-008' },
    });

    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });

  it('reassign 并发（$executeRaw 返回 0）→ E-DISPATCH-006（事务回滚，order.update 已同事务）', async () => {
    mockDb.riderProfile.findUnique.mockResolvedValue({
      id: 'r-new',
      applicationStatus: 'APPROVED',
      riderName: 'New',
    });
    mockTx.$executeRaw.mockResolvedValue(0); // 并发：刚 ASSIGNED 但 UPDATE 时已变

    await expect(
      service.reassignTask({
        taskId: 't-1',
        newRiderId: 'r-new',
        adminUserId: 'admin-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'E-DISPATCH-006' },
    });

    // 事务内 $executeRaw 被调（返回 0），但 order.update 也被调（同事务，事务回滚）
    // 关键：order.update 在 $executeRaw 之后，updated=0 时函数 return { ok: false }，不再调 order.update
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockTx.order.update).not.toHaveBeenCalled();
  });

  it('cancel 成功：事务内 $executeRaw UPDATE SET FAILED WHERE IN(...) + order.update riderId=null', async () => {
    mockTx.$executeRaw.mockResolvedValue(1);
    mockTx.order.update.mockResolvedValue({});

    const result = await service.cancelTask({
      taskId: 't-1',
      adminUserId: 'admin-1',
      reason: 'duplicate order',
    });

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockTx.order.update).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { riderId: null },
    });
    // note 追加取消记录：[cancel] 在参数 values 里
    const cancelArgs = (mockTx.$executeRaw.mock.calls[0] as unknown[]).flat();
    expect(
      cancelArgs.some((a) => typeof a === 'string' && a.includes('[cancel]')),
    ).toBe(true);
    expect(result.id).toBe('t-1');
  });

  it('cancel 状态不允许（DELIVERING）→ E-DISPATCH-007（已取货/配送中走 reportIssue）', async () => {
    mockDb.deliveryTask.findUnique.mockResolvedValue({ ...mockTaskComplete, status: 'DELIVERING' });

    await expect(
      service.cancelTask({ taskId: 't-1', adminUserId: 'admin-1' }),
    ).rejects.toMatchObject({
      response: { code: 'E-DISPATCH-007' },
    });

    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
  });

  it('listAvailableRiders：pipeline 批量 EXISTS（1 次 round-trip）+ 在线优先排序', async () => {
    mockDb.riderProfile.findMany.mockResolvedValue([
      {
        id: 'r-1',
        userId: 'u-1',
        riderName: 'A',
        phone: '1',
        vehicleType: 'BICYCLE',
        totalDeliveries: 10,
        rating: 4.5,
      },
      {
        id: 'r-2',
        userId: 'u-2',
        riderName: 'B',
        phone: '2',
        vehicleType: 'MOTORCYCLE',
        totalDeliveries: 20,
        rating: 5.0,
      },
    ]);
    const mockPipeline = {
      exists: vi.fn().mockReturnThis(),
      // r-1 offline (0), r-2 online (1)
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
      ]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline);

    const result = await service.listAvailableRiders();

    // pipeline 批量 EXISTS（1 次 round-trip，审查 P3-1 修复）
    expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
    expect(mockPipeline.exists).toHaveBeenCalledTimes(2);
    expect(mockPipeline.exists).toHaveBeenCalledWith('rider:online:u-1');
    expect(mockPipeline.exists).toHaveBeenCalledWith('rider:online:u-2');
    // 在线优先排序：r-2 (online) 排前，r-1 (offline) 排后
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('r-2');
    expect(result[0].isOnline).toBe(true);
    expect(result[1].id).toBe('r-1');
    expect(result[1].isOnline).toBe(false);
  });
});
