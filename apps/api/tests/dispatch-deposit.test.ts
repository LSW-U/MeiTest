/**
 * DispatchService 批 D 派单改造单测（2026-09-03）
 *
 * 覆盖（任务书批 D 验收 4 项）：
 *   - acceptTask 拦截：上限边界（=上限可接 / >上限 E-DEPOSIT-202 / 未缴 E-DEPOSIT-201 /
 *     reassign 同样校验）
 *   - 大厅过滤：工作仓过滤（preferredWarehouseIds）+ 档位上限过滤（超上限不出现）+
 *     空工作仓兼容（未指派显示全部）
 *   - 候选排序：评分权重（rating 主导/在途惩罚）、平局 depositAmount 高优先、
 *     资格标签（eligible/requiredDeposit）、跨仓放宽（crossWarehouse=true 工作仓不滤
 *     但金额资格保留；includeIneligible 附带不合格）
 *
 * mock：db + eligibility（真实 DepositEligibilityService 语义部分用真例）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockHelpers, mockRealtime, mockServer, mockRedis } = vi.hoisted(() => {
  const server = { to: vi.fn(() => server), emit: vi.fn() };
  return {
    mockDb: {
      deliveryTask: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        groupBy: vi.fn(),
      },
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      riderProfile: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      $executeRaw: vi.fn(),
    },
    mockHelpers: { withTransaction: vi.fn() },
    mockRealtime: { server },
    mockServer: server,
    mockRedis: { pipeline: vi.fn() },
  };
});

vi.mock('../src/shared/db', () => ({ db: mockDb, withTransaction: mockHelpers.withTransaction }));
vi.mock('../src/modules/realtime/realtime.gateway', () => ({
  RealtimeGateway: class {
    server = mockServer;
  },
}));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

// 真实 DepositEligibilityService（不 mock——派生逻辑本身在 eligibility 专测覆盖，
// 这里验证 dispatch 层接线正确性），档位缓存用 setTierCacheForTest 注入
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { setTierCacheForTest } from '../src/modules/rider/deposit-eligibility.service';
import { DepositEligibilityService } from '../src/modules/rider/deposit-eligibility.service';

/** seed 同构 4 档 */
const TIERS = [
  { id: 't4', minAmount: 5000, maxOrderAmount: 50000 },
  { id: 't3', minAmount: 1000, maxOrderAmount: 10000 },
  { id: 't2', minAmount: 500, maxOrderAmount: 5000 },
  { id: 't1', minAmount: 100, maxOrderAmount: 1000 },
];

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    orderId: 'order-1',
    riderId: null,
    warehouseId: 'wh-1',
    status: 'PENDING_ASSIGN',
    taskType: 'delivery',
    refundId: null,
    pickupAddress: 'Warehouse 1',
    pickupLat: { toNumber: () => -8.5 },
    pickupLng: { toNumber: () => 125.5 },
    dropoffAddress: 'Customer',
    dropoffLat: { toNumber: () => -8.55 },
    dropoffLng: { toNumber: () => 125.55 },
    assignedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    order: { orderNo: 'MM1', payableAmount: 800, paymentMethod: 'COD', deliveryFee: 250 },
    warehouse: { code: 'W01' },
    ...overrides,
  };
}

describe('DispatchService 批 D 派单改造', () => {
  let service: DispatchService;

  beforeEach(() => {
    service = new DispatchService(mockRealtime as never, new DepositEligibilityService());
    Object.values(mockDb.deliveryTask).forEach((fn) => fn.mockReset());
    mockDb.order.findUnique.mockReset();
    mockDb.riderProfile.findUnique.mockReset();
    mockDb.riderProfile.findMany.mockReset();
    mockHelpers.withTransaction.mockReset();
    mockRedis.pipeline.mockReset();
    setTierCacheForTest(TIERS);
  });

  describe('acceptTask 资格拦截', () => {
    function setupAccept(profileDeposit: number, orderAmount: number) {
      // resolveRiderProfileId（第一次）+ eligibility.getEligibility 内 findUnique（第二次）
      mockDb.riderProfile.findUnique
        .mockResolvedValueOnce({ id: 'r1' })
        .mockResolvedValueOnce({ id: 'r1', depositAmount: profileDeposit });
      mockDb.deliveryTask.findUnique.mockResolvedValue({
        id: 'task-1',
        orderId: 'order-1',
        status: 'PENDING_ASSIGN',
      });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: orderAmount });
    }

    it('未缴（0）→ E-DEPOSIT-201，事务不进', async () => {
      setupAccept(0, 800);
      await expect(service.acceptTask({ riderId: 'u1', taskId: 'task-1' })).rejects.toThrow(
        /Deposit required before accepting/,
      );
      expect(mockHelpers.withTransaction).not.toHaveBeenCalled();
    });

    it('订单金额 > 上限 → E-DEPOSIT-202（含所需档提示）', async () => {
      setupAccept(100, 5000); // $1 档上限 1000，订单 $50
      await expect(service.acceptTask({ riderId: 'u1', taskId: 'task-1' })).rejects.toThrow(
        /exceeds your tier limit 1000/,
      );
    });

    it('= 上限 可接（边界等值放行进事务）', async () => {
      setupAccept(100, 1000); // 订单恰 = $1 档上限
      // 第一次调用：入口状态检查（PENDING_ASSIGN）；第二次：事务后详情（ASSIGNED）
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce({ id: 'task-1', orderId: 'order-1', status: 'PENDING_ASSIGN' })
        .mockResolvedValueOnce({
          id: 'task-1',
          orderId: 'order-1',
          status: 'ASSIGNED',
          assignedAt: new Date(),
          pickedUpAt: null,
          deliveredAt: null,
          note: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          order: { payableAmount: 1000, paymentMethod: 'COD', deliveryFee: 250 },
          warehouse: { code: 'W01' },
          pickupLat: { toNumber: () => -8.5 },
          pickupLng: { toNumber: () => 125.5 },
          dropoffLat: { toNumber: () => -8.55 },
          dropoffLng: { toNumber: () => 125.55 },
        });
      mockHelpers.withTransaction.mockResolvedValue({ ok: true });
      const result = await service.acceptTask({ riderId: 'u1', taskId: 'task-1' });
      expect(result.status).toBe('ASSIGNED');
    });
  });

  describe('listPendingTasks 过滤（工作仓 + 档位）', () => {
    function setupHall(profile: { preferredWarehouseIds: string[]; depositAmount: number }) {
      mockDb.riderProfile.findUnique.mockResolvedValue({ id: 'r1', ...profile });
    }

    it('工作仓过滤：只返回 preferredWarehouseIds 内仓库的任务', async () => {
      setupHall({ preferredWarehouseIds: ['wh-1'], depositAmount: 100 });
      mockDb.deliveryTask.findMany.mockImplementation(async ({ where }: any) => {
        // 验证 SQL 层 where 已带 warehouseId in
        expect(where.warehouseId).toEqual({ in: ['wh-1'] });
        return [buildTask()];
      });
      const { items } = await service.listPendingTasks({ riderId: 'u1' });
      expect(items).toHaveLength(1);
    });

    it('档位过滤：超上限任务被内存滤除', async () => {
      setupHall({ preferredWarehouseIds: [], depositAmount: 100 }); // $1 档上限 1000
      mockDb.deliveryTask.findMany.mockResolvedValue([
        buildTask({ id: 'ok', order: { payableAmount: 800 } }), // ≤1000 可见
        buildTask({ id: 'too-big', order: { payableAmount: 5000 } }), // >1000 滤除
      ]);
      const { items } = await service.listPendingTasks({ riderId: 'u1' });
      expect(items.map((t) => t.id)).toEqual(['ok']);
    });

    it('未缴（0）：全部滤除（大厅空）', async () => {
      setupHall({ preferredWarehouseIds: [], depositAmount: 0 });
      mockDb.deliveryTask.findMany.mockResolvedValue([buildTask()]);
      const { items } = await service.listPendingTasks({ riderId: 'u1' });
      expect(items).toEqual([]);
    });

    it('空工作仓（未指派）→ 不过滤（兼容期显示全部）', async () => {
      setupHall({ preferredWarehouseIds: [], depositAmount: 5000 }); // $50 档
      mockDb.deliveryTask.findMany.mockImplementation(async ({ where }: any) => {
        expect(where.warehouseId).toBeUndefined(); // 未加 in 过滤
        return [buildTask()];
      });
      const { items } = await service.listPendingTasks({ riderId: 'u1' });
      expect(items).toHaveLength(1);
    });
  });

  describe('listDispatchCandidates（排序/平局/跨仓/标签）', () => {
    function buildRider(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'r-1',
        userId: 'u-1',
        riderName: 'Alice',
        phone: '+6701',
        vehicleType: 'MOTORCYCLE',
        rating: { toNumber: () => 4.5 } as unknown as number,
        depositAmount: 1000,
        preferredWarehouseIds: ['wh-1'],
        ...overrides,
      };
    }

    function setupCandidates(riders: ReturnType<typeof buildRider>[], orderAmount = 800) {
      mockDb.deliveryTask.findUnique.mockResolvedValue({
        id: 'task-1',
        warehouseId: 'wh-1',
        pickupLat: { toNumber: () => -8.5 },
        pickupLng: { toNumber: () => 125.5 },
        status: 'PENDING_ASSIGN',
        orderId: 'order-1',
      });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: orderAmount });
      mockDb.riderProfile.findMany.mockResolvedValue(riders);
      mockDb.deliveryTask.groupBy.mockResolvedValue([]); // 在途 0
      mockRedis.pipeline.mockReturnValue({
        exists: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(riders.map(() => [null, 1])), // 全在线
      });
    }

    it('资格过滤：超上限骑手默认不出现', async () => {
      setupCandidates([
        buildRider({ id: 'ok', depositAmount: 1000 }), // $10 档上限 10000 ≥ 800
        buildRider({ id: 'no', depositAmount: 0 }), // 未缴
      ]);
      const result = await service.listDispatchCandidates({ taskId: 'task-1' });
      expect(result.items.map((c) => c.riderProfileId)).toEqual(['ok']);
    });

    it('工作仓过滤：非本仓骑手默认不出现；crossWarehouse=true 放宽', async () => {
      setupCandidates([
        buildRider({ id: 'in-wh', preferredWarehouseIds: ['wh-1'] }),
        buildRider({ id: 'out-wh', preferredWarehouseIds: ['wh-2'] }),
      ]);

      const strict = await service.listDispatchCandidates({ taskId: 'task-1' });
      expect(strict.items.map((c) => c.riderProfileId)).toEqual(['in-wh']);

      const cross = await service.listDispatchCandidates({ taskId: 'task-1', crossWarehouse: true });
      expect(cross.items.map((c) => c.riderProfileId)).toContain('out-wh');
    });

    it('跨仓仍保留金额资格：超上限骑手 crossWarehouse 也不出现', async () => {
      // P3-3 修复（2026-09-03）：删掉被覆盖的死代码第一次 setupCandidates，
      //   直接用 $50 订单（5000 分）让 100 押金（上限 1000）不够
      setupCandidates(
        [buildRider({ id: 'poor', depositAmount: 100, preferredWarehouseIds: ['wh-2'] })],
        5000,
      );
      const cross = await service.listDispatchCandidates({ taskId: 'task-1', crossWarehouse: true });
      expect(cross.items).toEqual([]); // 资格不放宽
    });

    it('OFFLINE 过滤（批D审查观察项拍板）：离线骑手不进候选（crossWarehouse 同样只列在线）', async () => {
      setupCandidates([
        buildRider({ id: 'online-rider', preferredWarehouseIds: ['wh-1'] }),
        buildRider({ id: 'offline-rider', preferredWarehouseIds: ['wh-1'] }),
      ]);
      // 覆盖 pipeline：第 2 个骑手离线（exists=0）
      mockRedis.pipeline.mockReturnValue({
        exists: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1], // online-rider
          [null, 0], // offline-rider
        ]),
      });

      const strict = await service.listDispatchCandidates({ taskId: 'task-1' });
      expect(strict.items.map((c) => c.riderProfileId)).toEqual(['online-rider']);

      // 跨仓支援同样只列在线
      setupCandidates([
        buildRider({ id: 'on-x', preferredWarehouseIds: ['wh-2'] }),
        buildRider({ id: 'off-x', preferredWarehouseIds: ['wh-2'] }),
      ]);
      mockRedis.pipeline.mockReturnValue({
        exists: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 1], // on-x
          [null, 0], // off-x
        ]),
      });
      const cross = await service.listDispatchCandidates({ taskId: 'task-1', crossWarehouse: true });
      expect(cross.items.map((c) => c.riderProfileId)).toEqual(['on-x']);
    });

    it('includeIneligible=true：不合格候选附带且标签含 requiredDeposit', async () => {
      setupCandidates(
        [
          buildRider({ id: 'good', depositAmount: 1000 }),
          buildRider({ id: 'poor', depositAmount: 100 }),
        ],
        5000, // $50 订单：good（上限 10000）合格 / poor（上限 1000）不合格
      );
      const result = await service.listDispatchCandidates({ taskId: 'task-1', includeIneligible: true });
      const poor = result.items.find((c) => c.riderProfileId === 'poor')!;
      expect(poor.eligibility.eligible).toBe(false);
      // $50 订单（5000 分）：tier-2 上限 5000 等值达标且 minAmount(500) 更低 → 提示 $5 档即可
      expect(poor.eligibility.requiredDeposit).toBe(500);
    });

    it('排序：rating 高在前（同在途/同仓）', async () => {
      setupCandidates([
        buildRider({ id: 'low', rating: { toNumber: () => 3.0 } as unknown as number }),
        buildRider({ id: 'high', rating: { toNumber: () => 5.0 } as unknown as number }),
      ]);
      const result = await service.listDispatchCandidates({ taskId: 'task-1' });
      expect(result.items[0].riderProfileId).toBe('high');
      expect(result.items[0].score).toBeGreaterThan(result.items[1].score);
    });

    it('在途惩罚：同 rating 在途多者 score 更低', async () => {
      setupCandidates([
        buildRider({ id: 'busy' }),
        buildRider({ id: 'free' }),
      ]);
      mockDb.deliveryTask.groupBy.mockResolvedValue([
        { riderId: 'busy', _count: { _all: 3 } },
      ]);
      const result = await service.listDispatchCandidates({ taskId: 'task-1' });
      const busy = result.items.find((c) => c.riderProfileId === 'busy')!;
      const free = result.items.find((c) => c.riderProfileId === 'free')!;
      expect(busy.score).toBeLessThan(free.score);
    });

    it('平局：score 相同 → depositAmount 高者优先', async () => {
      setupCandidates([
        buildRider({ id: 'rich', depositAmount: 5000 }),
        buildRider({ id: 'modest', depositAmount: 1000 }),
      ]);
      // 两骑手 rating/在途/在线全同 → score 相同 → rich 排前
      const result = await service.listDispatchCandidates({ taskId: 'task-1' });
      expect(result.items[0].riderProfileId).toBe('rich');
      expect(result.items[0].score).toBe(result.items[1].score);
    });

    it('任务不存在 → E-DISPATCH-001', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(null);
      await expect(service.listDispatchCandidates({ taskId: 'x' })).rejects.toThrow(/Task not found/);
    });
  });

  describe('reassignTask 资格校验（跨仓支援保留金额资格）', () => {
    it('目标骑手超上限 → E-DEPOSIT-202（admin 显式操作也不放宽金额）', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue({
        orderId: 'order-1',
        status: 'ASSIGNED',
        riderId: 'old',
        note: null,
      });
      mockDb.riderProfile.findUnique
        .mockResolvedValueOnce({ id: 'new-rider', applicationStatus: 'APPROVED', riderName: 'Bob' }) // reassign 目标校验
        .mockResolvedValueOnce({ id: 'new-rider', depositAmount: 100 }); // eligibility 查
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: 5000 });

      await expect(
        service.reassignTask({ taskId: 'task-1', newRiderId: 'new-rider', adminUserId: 'admin' }),
      ).rejects.toThrow(/exceeds your tier limit 1000/);
    });
  });
  describe('assignTask（批 F P0-1：PENDING_ASSIGN admin 直接指派）', () => {
    /** assign 成功路径的调用链 mock：task(PENDING) → rider(APPROVED) → order → eligibility → tx → getAdminDetail */
    function setupAssign(opts: { taskStatus?: string; riderDeposit?: number; orderAmount?: number; riderApproved?: boolean } = {}) {
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce({ // 入口状态检查
          orderId: 'order-1',
          status: opts.taskStatus ?? 'PENDING_ASSIGN',
          note: null,
        })
        .mockResolvedValue({ // 事务后 getAdminDetail
          id: 'task-1',
          orderId: 'order-1',
          riderId: 'r-1',
          warehouseId: 'wh-1',
          status: 'ASSIGNED',
          taskType: 'delivery',
          refundId: null,
          pickupAddress: 'w',
          pickupLat: 0,
          pickupLng: 0,
          dropoffAddress: 'c',
          dropoffLat: 0,
          dropoffLng: 0,
          assignedAt: new Date(),
          pickedUpAt: null,
          deliveredAt: null,
          estimatedArrival: null,
          note: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          order: { orderNo: 'MM1', status: 'OUT_FOR_DELIVERY', payableAmount: opts.orderAmount ?? 800, paymentMethod: 'COD' },
          rider: { id: 'r-1', riderName: 'Bob', phone: '123' },
          warehouse: { code: 'W01' },
        });
      mockDb.riderProfile.findUnique
        .mockResolvedValueOnce({ // assign 目标校验
          id: 'r-1',
          applicationStatus: opts.riderApproved === false ? 'PENDING' : 'APPROVED',
          riderName: 'Bob',
        })
        .mockResolvedValueOnce({ id: 'r-1', depositAmount: opts.riderDeposit ?? 1000 }); // eligibility
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: opts.orderAmount ?? 800 });
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        order: { update: vi.fn().mockResolvedValue({}) },
      };
      mockHelpers.withTransaction.mockImplementation(async (fn) => fn(tx));
      return tx;
    }

    it('PENDING_ASSIGN → ASSIGNED：指派成功（事务双写 + note [assign] 留痕）', async () => {
      const tx = setupAssign();
      const result = await service.assignTask({ taskId: 'task-1', riderId: 'r-1', adminUserId: 'admin', reason: 'test' });
      expect(result.status).toBe('ASSIGNED');
      expect(result.rider?.id).toBe('r-1');
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { riderId: 'r-1' },
      });
    });

    it('超上限拒 → E-DEPOSIT-202（admin 指派不放宽金额资格）', async () => {
      setupAssign({ riderDeposit: 100, orderAmount: 5000 }); // $1 档上限 1000 < $50 订单
      await expect(
        service.assignTask({ taskId: 'task-1', riderId: 'r-1', adminUserId: 'admin' }),
      ).rejects.toThrow(/exceeds your tier limit 1000/);
      expect(mockHelpers.withTransaction).not.toHaveBeenCalled();
    });

    it('已 ASSIGNED 再 assign → E-DISPATCH-002（assign 只吃 PENDING_ASSIGN）', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue({ orderId: 'order-1', status: 'ASSIGNED', note: null });
      await expect(
        service.assignTask({ taskId: 'task-1', riderId: 'r-1', adminUserId: 'admin' }),
      ).rejects.toThrow(/Assign requires PENDING_ASSIGN/);
    });

    it('骑手未 APPROVED → E-DISPATCH-008', async () => {
      setupAssign({ riderApproved: false });
      await expect(
        service.assignTask({ taskId: 'task-1', riderId: 'r-1', adminUserId: 'admin' }),
      ).rejects.toThrow(/Rider invalid/);
    });

    it('事务 0 行（并发被抢）→ E-DISPATCH-002', async () => {
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce({ orderId: 'order-1', status: 'PENDING_ASSIGN', note: null })
        .mockResolvedValue(null);
      mockDb.riderProfile.findUnique
        .mockResolvedValueOnce({ id: 'r-1', applicationStatus: 'APPROVED', riderName: 'Bob' })
        .mockResolvedValueOnce({ id: 'r-1', depositAmount: 1000 });
      mockDb.order.findUnique.mockResolvedValue({ payableAmount: 800 });
      const tx = { $executeRaw: vi.fn().mockResolvedValue(0), order: { update: vi.fn() } };
      mockHelpers.withTransaction.mockImplementation(async (fn) => fn(tx));
      await expect(
        service.assignTask({ taskId: 'task-1', riderId: 'r-1', adminUserId: 'admin' }),
      ).rejects.toThrow(/changed concurrently/);
    });
  });
});
