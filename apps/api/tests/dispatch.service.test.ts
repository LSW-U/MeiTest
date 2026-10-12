/**
 * DispatchService 单测（聚焦核心业务逻辑）
 *
 * 覆盖：
 *   - listPendingTasks：按 status=PENDING_ASSIGN + warehouseId 过滤
 *   - acceptTask：乐观锁成功 / task 不存在 / 已被抢
 *   - pickupTask：状态机校验（非 ASSIGNED 拒绝）+ 非 owner 拒绝
 *   - deliverTask：COD 场景 PAID/SHORT/UNPAID + Order 状态推进
 *   - reportIssue：写 OrderEvent + WS 推客服
 *   - createTaskForOrder：幂等（已存在则跳过）
 *
 * mock：db（deliveryTask/order/cashCollection/orderEvent）+ withTransaction + RealtimeGateway
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockHelpers, mockRealtime, mockServer, mockSalesIncrement, mockLedgerWrite } = vi.hoisted(() => {
  const server = {
    to: vi.fn(() => server),
    emit: vi.fn(),
  };
  return {
    // 批A 销量真实统计：deliverTask COD 送达收款累加（helper 逻辑在 sales-count.helper.test.ts）
    mockSalesIncrement: vi.fn(),
    // 批C 对账分流：deliverTask COD 送达写台账（writer 逻辑在 reconciliation-ledger.test.ts）
    mockLedgerWrite: vi.fn(),
    mockDb: {
      deliveryTask: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      orderEvent: {
        create: vi.fn(),
      },
      cashCollection: {
        create: vi.fn(),
      },
      // P14 ④：createTaskForReturn 查 refund，pickupTask/startDelivering 写 refund
      refund: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      riderProfile: {
        findUnique: vi.fn().mockResolvedValue({ id: 'rider-profile-1' }),
        // W3 骑手积分：deliverTask 事务内 tx.riderProfile.update（increment totalDeliveries + points）
        update: vi.fn().mockResolvedValue({}),
      },
      $executeRaw: vi.fn(),
    },
    mockHelpers: {
      withTransaction: vi.fn(),
    },
    mockRealtime: { server },
    mockServer: server,
  };
});

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: mockHelpers.withTransaction,
  incrementSalesCountForOrder: mockSalesIncrement,
}));

// 批C：dispatch.service 走直连文件路径 import（非 barrel），单独 mock 本模块
vi.mock('../src/shared/db/reconciliation-ledger', () => ({
  writeReconciliationLedgerTx: mockLedgerWrite,
}));

vi.mock('../src/modules/realtime/realtime.gateway', () => ({
  RealtimeGateway: class {
    server = mockServer;
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 批 D（2026-09-03）：保证金资格校验注入——现有用例不触发资格逻辑
// （listPendingTasks/acceptTask 现会走 eligibility），mock 成「全额合格」透传
const { mockEligibility } = vi.hoisted(() => ({
  mockEligibility: {
    getEnabledTiers: vi.fn().mockResolvedValue([{ id: 'tier-1', minAmount: 100, maxOrderAmount: 1000 }]),
    deriveEligibility: vi.fn().mockReturnValue({ riderProfileId: 'r1', depositAmount: 100, maxOrderAmount: 1000, tierId: 'tier-1' }),
    isEligible: vi.fn().mockReturnValue(true),
    assertCanAccept: vi.fn().mockResolvedValue({ riderProfileId: 'r1', depositAmount: 100, maxOrderAmount: 1000, tierId: 'tier-1' }),
    getRequiredDeposit: vi.fn().mockResolvedValue(100),
    toLabel: vi.fn().mockReturnValue({ eligible: true, depositAmount: 100, maxOrderAmount: 1000 }),
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
}));

import { DispatchService } from '../src/modules/dispatch/dispatch.service';

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
    order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', deliveryFee: 250 },
    warehouse: { code: 'W01' },
    ...overrides,
  };
}

describe('DispatchService', () => {
  let service: DispatchService;

  beforeEach(() => {
    service = new DispatchService(mockRealtime as never, mockEligibility as never, null);
    Object.values(mockDb).forEach((table) => {
      if (typeof table === 'object') {
        Object.values(table).forEach((fn) => fn.mockReset?.());
      }
    });
    mockHelpers.withTransaction.mockReset();
    // 批A 销量真实统计：reset 累加 mock
    mockSalesIncrement.mockReset();
    // 批C 对账分流：reset 台账写入 mock
    mockLedgerWrite.mockReset();
    mockServer.to.mockClear();
    mockServer.emit.mockClear();
    // resolveRiderProfileId 默认返回 rider-profile-1（所有 dispatch 方法入口调）
    // 测试用 riderId='r1'，所以 mock 返回 id='r1' 保持一致
    // 批 D：listPendingTasks 需要 preferredWarehouseIds（空=不过滤）+ depositAmount
    mockDb.riderProfile.findUnique.mockResolvedValue({
      id: 'r1',
      preferredWarehouseIds: [],
      depositAmount: 100,
    });
    // 资格 mock 复位到「全额合格」（个别批 D 用例单独覆盖）
    mockEligibility.getEnabledTiers.mockResolvedValue([{ id: 'tier-1', minAmount: 100, maxOrderAmount: 1000 }]);
    mockEligibility.deriveEligibility.mockReturnValue({ riderProfileId: 'r1', depositAmount: 100, maxOrderAmount: 1000, tierId: 'tier-1' });
    mockEligibility.isEligible.mockReturnValue(true);
    mockEligibility.assertCanAccept.mockResolvedValue({ riderProfileId: 'r1', depositAmount: 100, maxOrderAmount: 1000, tierId: 'tier-1' });
  });

  describe('listPendingTasks', () => {
    it('按 status=PENDING_ASSIGN 查询', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([buildTask()]);
      const result = await service.listPendingTasks({ riderId: 'r1' });
      expect(result.items).toHaveLength(1);
      expect(mockDb.deliveryTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING_ASSIGN' }),
        }),
      );
    });

    it('T6 联系拨号：order.deliveryAddress 有 phone → toView 透传 contactPhone', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([
        buildTask({
          order: { orderNo: 'MM1', deliveryAddress: { name: 'João', phone: '+670 7733 4072' } },
        }),
      ]);
      const result = await service.listPendingTasks({ riderId: 'r1' });
      expect(result.items[0]?.contactPhone).toBe('+670 7733 4072');
    });

    it('T6 联系拨号：deliveryAddress 无 phone / null → contactPhone undefined（前端降级 toast）', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([
        buildTask({ order: { orderNo: 'MM2', deliveryAddress: { name: 'No phone' } } }),
        buildTask({ order: { orderNo: 'MM3', deliveryAddress: null } }),
      ]);
      const result = await service.listPendingTasks({ riderId: 'r1' });
      expect(result.items[0]?.contactPhone).toBeUndefined();
      expect(result.items[1]?.contactPhone).toBeUndefined();
    });

    it('P0-1 修复：order.deliveryFee 透传 → toView 返回 deliveryFee（骑手卡片展示真实配送费）', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([
        buildTask({ order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', deliveryFee: 250 } }),
        buildTask({ order: { orderNo: 'MM2', payableAmount: 100, paymentMethod: 'COD' } }), // 无 deliveryFee → undefined
      ]);
      const result = await service.listPendingTasks({ riderId: 'r1' });
      expect(result.items[0]?.deliveryFee).toBe(250);
      expect(result.items[1]?.deliveryFee).toBeUndefined();
    });

    it('P6 #7：pickup/dropoff 坐标齐全 → 透传 distanceKm + estimatedMinutes', async () => {
      // 用 number 直接覆盖（绕过 buildTask 的 Decimal mock，Number(number) 正常）
      mockDb.deliveryTask.findMany.mockResolvedValue([
        buildTask({
          pickupLat: -8.5568,
          pickupLng: 125.5600,
          dropoffLat: -8.5500,
          dropoffLng: 125.5660,
        }),
      ]);
      const result = await service.listPendingTasks({ riderId: 'r1' });
      const view = result.items[0]!;
      expect(view.distanceKm).toBeGreaterThan(0.5);
      expect(view.distanceKm).toBeLessThan(1.5);
      // ~1km @ 20km/h ≈ 3 分钟
      expect(view.estimatedMinutes).toBeGreaterThan(0);
      expect(view.estimatedMinutes).toBeLessThanOrEqual(45);
    });

    it('P6 #7：坐标缺失（0 历史数据）→ distanceKm/estimatedMinutes undefined（前端降级隐藏）', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([
        buildTask({ pickupLat: 0, pickupLng: 0, dropoffLat: 0, dropoffLng: 0 }),
      ]);
      const result = await service.listPendingTasks({ riderId: 'r1' });
      // P3-7 修复：(0,0) 视为历史无坐标哨兵，toView 返回 undefined（非 0）
      // 避免骑手卡片显示「0.0km · 0 分钟」，前端降级隐藏 ETA
      expect(result.items[0]?.distanceKm).toBeUndefined();
      expect(result.items[0]?.estimatedMinutes).toBeUndefined();
    });

    it('传 warehouseId 时按仓库过滤', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([]);
      await service.listPendingTasks({ riderId: 'r1', warehouseId: 'wh-2' });
      expect(mockDb.deliveryTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING_ASSIGN',
            warehouseId: 'wh-2',
          }),
        }),
      );
    });

    it('limit 上限 100', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([]);
      await service.listPendingTasks({ riderId: 'r1', limit: 500 });
      const call = mockDb.deliveryTask.findMany.mock.calls[0]?.[0] as { take: number };
      expect(call.take).toBe(100);
    });

    // 批2 性能清理（20261012）：先过滤后分页——捞取批里含不合格单时补捞，保证返回 ≤limit 且不漏单
    it('批2 先过滤后分页：首批含档位不合格单 → 补捞第二批凑满 limit', async () => {
      // 第一批：take=3 返满 3 单，其中 1 单超档位（payableAmount 5000 > maxOrderAmount 1000）
      mockDb.deliveryTask.findMany.mockResolvedValueOnce([
        buildTask({ id: 't-ok', order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', deliveryFee: 250 } }),
        buildTask({ id: 't-ok1b', order: { orderNo: 'MM4', payableAmount: 300, paymentMethod: 'COD', deliveryFee: 250 } }),
        buildTask({ id: 't-over', order: { orderNo: 'MM2', payableAmount: 5000, paymentMethod: 'COD', deliveryFee: 250 } }),
      ]);
      // 第二批补捞：1 单合格（此时 visible 尚缺 1）
      mockDb.deliveryTask.findMany.mockResolvedValueOnce([
        buildTask({ id: 't-ok2', order: { orderNo: 'MM3', payableAmount: 200, paymentMethod: 'COD', deliveryFee: 250 } }),
      ]);
      // 第三批不捞（验证只调 2 次）
      mockDb.deliveryTask.findMany.mockResolvedValueOnce([]);

      mockEligibility.isEligible.mockImplementation(
        (_snap: unknown, amount: number) => amount <= 1000,
      );

      const result = await service.listPendingTasks({ riderId: 'r1', limit: 3 });

      // 恰好 2 次查询（首批 + 补捞），首批合格 2 条 + 第二批合格 1 条 = 3
      expect(mockDb.deliveryTask.findMany).toHaveBeenCalledTimes(2);
      // 第二批用 skip=3 续捞
      const second = mockDb.deliveryTask.findMany.mock.calls[1]?.[0] as { skip: number };
      expect(second.skip).toBe(3);
      expect(result.items).toHaveLength(3);
      expect(mockEligibility.isEligible).toHaveBeenCalled();
    });

    it('批2 先过滤后分页：首批全部合格且不足 limit → 不补捞（batch 捞尽即止）', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValueOnce([
        buildTask({ order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', deliveryFee: 250 } }),
      ]);
      const result = await service.listPendingTasks({ riderId: 'r1', limit: 50 });
      expect(mockDb.deliveryTask.findMany).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(1);
    });

    it('批A A4/T5-c 预约单可见性：where 带 order OR（scheduledFor null 或已到时）', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([]);
      await service.listPendingTasks({ riderId: 'r1' });
      const call = mockDb.deliveryTask.findMany.mock.calls[0]?.[0] as {
        where: { order: { OR: unknown[] } };
      };
      // 未消费门面的大厅同样只能看到「即时单 + 已到开门时间的预约单」
      const or = call.where.order.OR as Array<Record<string, unknown>>;
      expect(or).toHaveLength(2);
      expect(or[0]).toEqual({ scheduledFor: null });
      // 第二支路：scheduledFor <= now（now 为服务端生成时间，只验证 lte 形状）
      expect(or[1]).toEqual({ scheduledFor: { lte: expect.any(Date) } });
    });
  });

  describe('listMyTasks', () => {
    it('resolveRiderProfileId 转 RiderProfile.id + status in 进行中', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([buildTask({ status: 'ASSIGNED' })]);
      const result = await service.listMyTasks({ riderId: 'r1' });
      expect(result.items).toHaveLength(1);
      // resolveRiderProfileId：User.id 'r1' → RiderProfile.id 'r1'（mock 返回）
      expect(mockDb.riderProfile.findUnique).toHaveBeenCalled();
      expect(mockDb.deliveryTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            riderId: 'r1',
            status: { in: ['ASSIGNED', 'PICKED_UP', 'DELIVERING'] },
          }),
        }),
      );
    });

    it('include order + warehouse（前端 pickups/deliveries tab 必需字段）', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([buildTask()]);
      await service.listMyTasks({ riderId: 'r1' });
      expect(mockDb.deliveryTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            order: expect.objectContaining({ select: expect.objectContaining({ orderNo: true }) }),
            warehouse: expect.objectContaining({ select: expect.objectContaining({ code: true }) }),
          }),
        }),
      );
    });

    it('无进行中任务 → 空数组', async () => {
      mockDb.deliveryTask.findMany.mockResolvedValue([]);
      const result = await service.listMyTasks({ riderId: 'r1' });
      expect(result.items).toEqual([]);
    });
  });

  describe('acceptTask', () => {
    it('task 不存在 → E-DISPATCH-001', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(null);
      await expect(
        service.acceptTask({ riderId: 'r1', taskId: 'tx' }),
      ).rejects.toThrow(/Task not found/);
    });

    it('task 状态非 PENDING_ASSIGN → E-DISPATCH-002', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ status: 'ASSIGNED' }),
      );
      await expect(
        service.acceptTask({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toThrow(/cannot be grabbed/);
    });

    it('Happy path：乐观锁 + order.update + WS 广播', async () => {
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce(buildTask()) // 第一次查 status
        .mockResolvedValueOnce(buildTask({ status: 'ASSIGNED' })); // 事务后查详情
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(1),
            order: { update: vi.fn().mockResolvedValue({}) },
          };
          return fn(tx);
        },
      );

      const result = await service.acceptTask({ riderId: 'r1', taskId: 'task-1' });

      expect(result.status).toBe('ASSIGNED');
      expect(mockServer.to).toHaveBeenCalledWith('riders');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'dispatch:task-accepted',
        expect.objectContaining({ taskId: 'task-1', riderId: 'r1' }),
      );
    });

    it('乐观锁返回 0（并发抢）→ E-DISPATCH-002', async () => {
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce(buildTask()) // 第一次查（PENDING_ASSIGN）
        .mockResolvedValueOnce(buildTask({ status: 'ASSIGNED' })); // 抛错后查
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            $executeRaw: vi.fn().mockResolvedValue(0), // 被并发抢
            order: { update: vi.fn() },
          };
          return fn(tx);
        },
      );

      await expect(
        service.acceptTask({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toThrow(/cannot be grabbed/);
    });
  });

  describe('pickupTask', () => {
    it('task 不存在 → E-DISPATCH-001', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(null);
      await expect(
        service.pickupTask({ riderId: 'r1', taskId: 'tx' }),
      ).rejects.toThrow(/Task not found/);
    });

    it('非 owner → E-DISPATCH-003', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'other-rider' }),
      );
      await expect(
        service.pickupTask({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toThrow(/not assigned to this rider/);
    });

    it('状态非 ASSIGNED → E-DISPATCH-004', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PENDING_ASSIGN' }),
      );
      await expect(
        service.pickupTask({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toThrow(/cannot be picked up/);
    });

    it('Happy path：状态机推进 + WS 广播 order:status', async () => {
      // P14 ④：pickupTask 重构走 withTransaction（taskType=return 时事务内写 refund.pickupAt）
      const txDeliveryTaskUpdate = vi.fn().mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PICKED_UP', taskType: 'delivery' }),
      );
      const txOrderUpdate = vi.fn().mockResolvedValue({});
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'ASSIGNED', taskType: 'delivery', orderId: 'order-1' }),
      );
      mockHelpers.withTransaction.mockImplementation(async (fn) =>
        fn({
          // P1-7：pickupTask 守卫翻转（乐观锁成功 count=1）
          $executeRaw: vi.fn().mockResolvedValue(1),
          deliveryTask: { update: txDeliveryTaskUpdate, findUnique: vi.fn().mockResolvedValue({ status: 'PICKED_UP' }) },
          order: { update: txOrderUpdate },
          refund: { update: vi.fn() },
        }),
      );

      const result = await service.pickupTask({ riderId: 'r1', taskId: 'task-1' });
      expect(result.status).toBe('PICKED_UP');
      // Order 状态机推进（事务内）
      expect(txOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ status: 'PICKED' }),
        }),
      );
      // WS 推 order:status（事务外）
      expect(mockServer.to).toHaveBeenCalledWith('order:order-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'order:status',
        expect.objectContaining({ status: 'PICKED' }),
      );
    });
  });

  // ===== 批2（后端依赖专项 2026-10-01）：evidenceUrls 服务端校验 =====
  describe('evidenceUrls 校验（批2 validateEvidenceUrls）', () => {
    // storage=null（单测惯例）：前缀校验跳过仅数量校验生效；前缀分支用注入 mock storage 的实例测
    function setupPickup(status = 'ASSIGNED') {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status, taskType: 'delivery', orderId: 'order-1' }),
      );
      const txDeliveryTaskUpdate = vi.fn().mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PICKED_UP', taskType: 'delivery' }),
      );
      mockHelpers.withTransaction.mockImplementation(async (fn) =>
        fn({
          // P1-7：pickupTask 守卫翻转（乐观锁成功 count=1）
          $executeRaw: vi.fn().mockResolvedValue(1),
          deliveryTask: { update: txDeliveryTaskUpdate, findUnique: vi.fn().mockResolvedValue({ status: 'PICKED_UP' }) },
          order: { update: vi.fn().mockResolvedValue({}) },
          refund: { update: vi.fn() },
        }),
      );
      return { txDeliveryTaskUpdate };
    }

    it('>3 张 → 400 E-DISPATCH-023（防御直调，DTO max 3 之外的兜底）', async () => {
      setupPickup();
      await expect(
        service.pickupTask({
          riderId: 'r1',
          taskId: 'task-1',
          evidenceUrls: ['http://x/1.jpg', 'http://x/2.jpg', 'http://x/3.jpg', 'http://x/4.jpg'],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-023' } });
    });

    it('外部前缀 URL → 400 E-DISPATCH-023（isOwnUrl 语义，注入 mock storage 验证前缀分支）', async () => {
      const { txDeliveryTaskUpdate } = setupPickup();
      const withStorage = new DispatchService(
        mockRealtime as never,
        mockEligibility as never,
        null,
        { isOwnUrl: (url: string) => url.startsWith('http://own/meimart/') } as never,
      );
      await expect(
        withStorage.pickupTask({
          riderId: 'r1',
          taskId: 'task-1',
          evidenceUrls: ['https://evil.com/proof.jpg'],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-023' } });
      expect(txDeliveryTaskUpdate).not.toHaveBeenCalled();
    });

    it('合法前缀 evidenceUrls → 落库（pickup update data 含 evidenceUrls）', async () => {
      const { txDeliveryTaskUpdate } = setupPickup();
      const withStorage = new DispatchService(
        mockRealtime as never,
        mockEligibility as never,
        null,
        { isOwnUrl: (url: string) => url.startsWith('http://own/meimart/') } as never,
      );
      const urls = ['http://own/meimart/tasks/evidence-1.jpg', 'http://own/meimart/tasks/evidence-2.png'];
      await withStorage.pickupTask({ riderId: 'r1', taskId: 'task-1', evidenceUrls: urls });
      expect(txDeliveryTaskUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ evidenceUrls: urls }),
        }),
      );
    });

    it('不传 evidenceUrls → update data 不含 evidenceUrls 键（向后兼容）', async () => {
      const { txDeliveryTaskUpdate } = setupPickup();
      await service.pickupTask({ riderId: 'r1', taskId: 'task-1' });
      expect(txDeliveryTaskUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ evidenceUrls: expect.anything() }),
        }),
      );
    });

    it('deliverTask >3 张 → 400 E-DISPATCH-023', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PICKED_UP' }),
      );
      await expect(
        service.deliverTask({
          riderId: 'r1',
          taskId: 'task-1',
          evidenceUrls: Array.from({ length: 4 }, (_, i) => `http://x/${i}.jpg`),
        }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-023' } });
    });

    it('reportIssue >3 张 → 400 E-DISPATCH-023', async () => {
      await expect(
        service.reportIssue({
          riderId: 'r1',
          taskId: 'task-1',
          reason: 'OTHER',
          evidenceUrls: Array.from({ length: 5 }, (_, i) => `http://x/${i}.jpg`),
        }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-023' } });
    });

    it('回归：E-DISPATCH-003 归属校验不破坏（他人任务携合法 URL 仍 403 语义 Conflict）', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'other-rider', status: 'ASSIGNED' }),
      );
      await expect(
        service.pickupTask({
          riderId: 'r1',
          taskId: 'task-1',
          evidenceUrls: ['http://x/1.jpg'],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-003' } });
    });
  });

  // ============================================================
  // A2.6（P1-7，方案v2 20261011）：并发取货/送达只计一次积分/销量
  // COD 与非 COD 一并断言（方案 v2 修正：CashCollection 零唯一约束，
  // COD 无 DB 兜底——WHERE status 守卫是四项计数唯一防线）。
  // 守卫语义：tx.$executeRaw UPDATE ... WHERE id AND status IN (前置状态)，
  // 赢家 flipped=1 继续计数；输家 flipped=0 → E-DISPATCH-004 回滚，计数不落。
  // ============================================================
  describe('A2.6 - P1-7 WHERE status 守卫（并发取货/送达只计一次）', () => {
    function setupDeliverTask(status: string, paymentMethod: 'COD' | 'WECHAT') {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status,
          taskType: 'delivery',
          orderId: 'order-1',
          order: {
            orderNo: 'MM1',
            payableAmount: 100,
            paymentMethod,
            deliveryFee: 250,
          },
        }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED', taskType: 'delivery' }),
      );
      mockDb.riderProfile.findUnique.mockResolvedValue({ id: 'r1' });
      // tx 复用 mockDb（P1-2 先例）；守卫经 mockDb.$executeRaw
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );
    }

    it('并发取货输家（flipped=0）→ E-DISPATCH-004 且不推进 Order 状态机（PICKED 不落）', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'ASSIGNED', taskType: 'delivery', orderId: 'order-1' }),
      );
      const txOrderUpdate = vi.fn().mockResolvedValue({});
      mockDb.$executeRaw.mockResolvedValue(0); // 输家：并发赢家已翻走 ASSIGNED
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce(buildTask({ riderId: 'r1', status: 'ASSIGNED', taskType: 'delivery' }))
        .mockResolvedValueOnce({ status: 'PICKED_UP' }); // 事务内输家重查
      mockHelpers.withTransaction.mockImplementation(async (fn) =>
        fn({
          $executeRaw: mockDb.$executeRaw,
          deliveryTask: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ status: 'PICKED_UP' }) },
          order: { update: txOrderUpdate },
          refund: { update: vi.fn() },
        }),
      );

      await expect(
        service.pickupTask({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-004' } });

      // 守卫 SQL 带状态前置（WHERE ... AND status = 'ASSIGNED'）
      expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = mockDb.$executeRaw.mock.calls[0][0].join(' ');
      expect(sql).toContain("status = 'ASSIGNED'");
      // 输家：Order 状态机不推进（PICKED 不落库）
      expect(txOrderUpdate).not.toHaveBeenCalled();
    });

    it('并发送达输家（flipped=0）→ E-DISPATCH-004 回滚：销量/积分/收款全不落（COD 无 DB 兜底，守卫是唯一防线）', async () => {
      setupDeliverTask('PICKED_UP', 'COD');
      mockDb.$executeRaw.mockResolvedValue(0); // 输家：另一笔并发送达已翻走
      mockDb.deliveryTask.findUnique
        .mockResolvedValueOnce(buildTask({
          riderId: 'r1', status: 'PICKED_UP', taskType: 'delivery', orderId: 'order-1',
          order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD' },
        }))
        .mockResolvedValueOnce({ status: 'DELIVERED' }); // 事务内输家重查
      mockDb.deliveryTask.update.mockResolvedValue(buildTask({ riderId: 'r1', status: 'DELIVERED' }));

      await expect(
        service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 }),
      ).rejects.toMatchObject({ response: { code: 'E-DISPATCH-004' } });

      // 守卫 SQL 前置状态含 PICKED_UP/DELIVERING 双值（第二次调用=送达守卫，第一次=前置断言无关）
      const deliverGuardCall = mockDb.$executeRaw.mock.calls.find((call) =>
        call[0].join(' ').includes('IN ('),
      );
      expect(deliverGuardCall![0].join(' ')).toContain("IN ('PICKED_UP', 'DELIVERING')");
      // COD 四项计数全不落（守卫翻转失败 → 事务内计数代码未执行）
      expect(mockSalesIncrement).not.toHaveBeenCalled(); // 销量
      expect(mockDb.cashCollection.create).not.toHaveBeenCalled(); // 收款
      expect(mockDb.riderProfile.update).not.toHaveBeenCalled(); // 积分
      expect(mockDb.order.update).not.toHaveBeenCalled(); // 订单状态
    });

    it('并发送达赢家（flipped=1）→ COD 单笔送达销量/积分/收款正常落（计数只此一次）', async () => {
      setupDeliverTask('PICKED_UP', 'COD');
      mockDb.$executeRaw.mockResolvedValue(1); // 赢家
      mockSalesIncrement.mockResolvedValue(undefined);
      mockDb.cashCollection.create.mockResolvedValue({ id: 'cash-1' });
      mockDb.riderProfile.findUnique
        .mockResolvedValueOnce({ id: 'r1' }) // resolveRiderProfileId
        .mockResolvedValueOnce({ points: 110 }); // 事务内重读 points 算 tier

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });

      // 守卫 SQL 翻转成功 → 四项计数各落一次
      expect(mockSalesIncrement).toHaveBeenCalledTimes(1);
      expect(mockDb.cashCollection.create).toHaveBeenCalledTimes(1);
      expect(mockDb.riderProfile.update).toHaveBeenCalledTimes(2); // increment points + set tier
      expect(mockDb.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELIVERED_PAID' }),
        }),
      );
    });

    it('非 COD（预付 WECHAT）并发送达赢家 → DELIVERED 状态推进，无收款/销量（销量已在 markPaid 累加）', async () => {
      setupDeliverTask('PICKED_UP', 'WECHAT');
      mockDb.$executeRaw.mockResolvedValue(1); // 赢家
      mockDb.order.update.mockResolvedValue({});
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED', taskType: 'delivery' }),
      );

      const result = await service.deliverTask({ riderId: 'r1', taskId: 'task-1' });

      expect(result.status).toBe('DELIVERED');
      expect(mockDb.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
      // 预付单：deliverTask 不建收款、不累加销量（markPaidTx 已累加）
      expect(mockDb.cashCollection.create).not.toHaveBeenCalled();
      expect(mockSalesIncrement).not.toHaveBeenCalled();
      // 守卫 SQL 同样前置状态（非 COD 与 COD 共用同一唯一防线）
      const sql2 = mockDb.$executeRaw.mock.calls.find((call) =>
        call[0].join(' ').includes('IN ('),
      );
      expect(sql2![0].join(' ')).toContain("IN ('PICKED_UP', 'DELIVERING')");
    });
  });

  describe('deliverTask - COD 场景', () => {
    function setupForDeliver(opts: { collectedAmount?: number; payableAmount?: number }) {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'PICKED_UP',
          orderId: 'order-1',
          order: {
            orderNo: 'MM1',
            payableAmount: opts.payableAmount ?? 100,
            paymentMethod: 'COD',
          },
        }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED' }),
      );
      // P1-2 修复后 deliverTask 走 withTransaction，mock 让 tx 复用 mockDb
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );
    }

    it('collectedAmount = payableAmount → cashResult=PAID + Order DELIVERED_PAID', async () => {
      setupForDeliver({ collectedAmount: 100, payableAmount: 100 });

      await service.deliverTask({
        riderId: 'r1',
        taskId: 'task-1',
        collectedAmount: 100,
      });

      expect(mockDb.cashCollection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collectedAmount: 100,
            result: 'PAID',
          }),
        }),
      );
      expect(mockDb.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELIVERED_PAID' }),
        }),
      );
    });

    it('collectedAmount < payableAmount → cashResult=SHORT', async () => {
      setupForDeliver({ collectedAmount: 80, payableAmount: 100 });

      await service.deliverTask({
        riderId: 'r1',
        taskId: 'task-1',
        collectedAmount: 80,
      });

      expect(mockDb.cashCollection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ result: 'SHORT' }),
        }),
      );
    });

    it('collectedAmount = 0（拒付）→ cashResult=UNPAID + Order DELIVERED_UNPAID', async () => {
      setupForDeliver({ collectedAmount: 0, payableAmount: 100 });

      await service.deliverTask({
        riderId: 'r1',
        taskId: 'task-1',
        collectedAmount: 0,
      });

      expect(mockDb.cashCollection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ result: 'UNPAID' }),
        }),
      );
      expect(mockDb.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELIVERED_UNPAID' }),
        }),
      );
    });

    it('批C 对账分流：COD 送达 → 同事务写台账（R8 落点，拒付 amountUsd=0 也写）', async () => {
      // PAID 场景：amountUsd=实收
      setupForDeliver({ collectedAmount: 100, payableAmount: 100 });
      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });
      expect(mockLedgerWrite).toHaveBeenCalledTimes(1);
      expect(mockLedgerWrite).toHaveBeenCalledWith(mockDb, {
        orderId: 'order-1',
        orderNo: 'MM1',
        paymentMethod: 'COD',
        amountUsd: 100,
        cashResult: 'PAID',
      });

      // 拒付场景（collectedAmount=0 → UNPAID）：台账仍写（T3 未支付口径），amountUsd=0
      mockLedgerWrite.mockClear();
      setupForDeliver({ collectedAmount: 0, payableAmount: 100 });
      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 0 });
      expect(mockLedgerWrite).toHaveBeenCalledWith(mockDb, {
        orderId: 'order-1',
        orderNo: 'MM1',
        paymentMethod: 'COD',
        amountUsd: 0,
        cashResult: 'UNPAID',
      });
    });

    it('批C 对账分流：非 COD（预付单送达）→ 不写台账', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'PICKED_UP',
          orderId: 'order-1',
          order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'WECHAT' },
        }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED' }),
      );
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1' });

      expect(mockLedgerWrite).not.toHaveBeenCalled();
    });
  });

  describe('deliverTask - 批A 销量真实统计（COD 送达收款累加）', () => {
    function setupForDeliver(opts: { collectedAmount?: number; payableAmount?: number; paymentMethod?: string }) {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'PICKED_UP',
          orderId: 'order-1',
          order: {
            orderNo: 'MM1',
            payableAmount: opts.payableAmount ?? 100,
            paymentMethod: opts.paymentMethod ?? 'COD',
          },
        }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED' }),
      );
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );
    }

    it('COD 收款 PAID → incrementSalesCountForOrder（与订单状态推进同事务，operatorId=riderId）', async () => {
      setupForDeliver({ collectedAmount: 100, payableAmount: 100 });

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });

      expect(mockSalesIncrement).toHaveBeenCalledTimes(1);
      expect(mockSalesIncrement).toHaveBeenCalledWith(mockDb, 'order-1', { operatorId: 'r1' });
    });

    it('COD 少收 SHORT → 仍累加（状态为 DELIVERED_PAID，销量按数量计）', async () => {
      setupForDeliver({ collectedAmount: 80, payableAmount: 100 });

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 80 });

      expect(mockSalesIncrement).toHaveBeenCalledTimes(1);
    });

    it('COD 拒付 UNPAID → 不累加', async () => {
      setupForDeliver({ collectedAmount: 0, payableAmount: 100 });

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 0 });

      expect(mockSalesIncrement).not.toHaveBeenCalled();
    });

    it('预付单送达（DELIVERED）→ 不在此累加（已在 markPaidTx 累加过）', async () => {
      setupForDeliver({ paymentMethod: 'WECHAT' });

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1' });

      expect(mockSalesIncrement).not.toHaveBeenCalled();
    });
  });

  describe('deliverTask - F1 return 任务拦截（2026-08-24 审查报告）', () => {
    it('return 任务送达 → 只推进 task→DELIVERED，不碰 Order / 不建 CashCollection / 不计积分', async () => {
      // return 任务走到第三步 DELIVERING，调 deliverTask 送达
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'DELIVERING',
          taskType: 'return',
          refundId: 'refund-1',
          orderId: 'order-1',
          order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD' },
        }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED', taskType: 'return', refundId: 'refund-1' }),
      );
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );

      const result = await service.deliverTask({
        riderId: 'r1',
        taskId: 'task-1',
        collectedAmount: 100,
      });

      expect(result.status).toBe('DELIVERED');
      // 不碰 Order（退货单已是 CANCELLED，不应倒退回 DELIVERED_*）
      expect(mockDb.order.update).not.toHaveBeenCalled();
      // 不建 CashCollection（退货不收款）
      expect(mockDb.cashCollection.create).not.toHaveBeenCalled();
      // 不计积分（return 不计）
      expect(mockDb.riderProfile.update).not.toHaveBeenCalled();
      // 也不应进入事务（return 送达走独立分支，无 withTransaction）
      expect(mockHelpers.withTransaction).not.toHaveBeenCalled();
    });

    it('delivery 任务送达 → 仍正常推进 Order + 计积分 + 同步 tier（回归保护）', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'PICKED_UP',
          taskType: 'delivery',
          orderId: 'order-1',
          order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD' },
        }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED', taskType: 'delivery' }),
      );
      // F5 修复：deliverTask 事务内 increment points 后重读 points 算 tier 再写回
      //   - 第 1 次 findUnique = resolveRiderProfileId（riderId → profileId）
      //   - 第 2 次 findUnique = 事务内重读 points（返回 mock points 供 calcTier）
      let findUniqueCallCount = 0;
      mockDb.riderProfile.findUnique.mockImplementation(async () => {
        findUniqueCallCount += 1;
        // resolveRiderProfileId 返回 { id }；事务内重读返回 { points }
        return findUniqueCallCount === 1 ? { id: 'r1' } : { points: 110 };
      });
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
      );

      await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });

      expect(mockDb.order.update).toHaveBeenCalled();
      expect(mockDb.cashCollection.create).toHaveBeenCalled();
      // 积分 increment + tier 同步写（两次 update：increment points / set tier）
      expect(mockDb.riderProfile.update).toHaveBeenCalledTimes(2);
      // 第二次 update 写 tier=calcTier(110)=SILVER（100 门槛）
      expect(mockDb.riderProfile.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'r1' },
        data: { tier: 'SILVER' },
      });
    });
  });

  describe('reportIssue - S5 / V2-S1 / V2-S2 修复', () => {
    it('写 OrderEvent(ISSUE_REPORTED) + WS 推 customer-service room', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PICKED_UP', orderId: 'order-1' }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'FAILED',
          order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', status: 'PICKED' },
        }),
      );
      // V2-S1：orderSnapshot 预查
      mockDb.order.findUnique.mockResolvedValue({ status: 'PICKED' });
      // V2-S1：withTransaction mock
      mockHelpers.withTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            deliveryTask: { update: vi.fn().mockResolvedValue(
              buildTask({
                riderId: 'r1',
                status: 'FAILED',
                order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', status: 'PICKED' },
              }),
            ) },
            orderEvent: { create: vi.fn().mockResolvedValue({}) },
          };
          return fn(tx);
        },
      );

      const result = await service.reportIssue({
        riderId: 'r1',
        taskId: 'task-1',
        reason: 'CUSTOMER_UNREACHABLE',
        note: '电话打不通',
      });

      expect(result.status).toBe('FAILED');
      // 写 OrderEvent（事务内）
      expect(mockDb.orderEvent.create).not.toHaveBeenCalled(); // 用 tx 不用 db
      // WS 推 customer-service
      expect(mockServer.to).toHaveBeenCalledWith('customer-service');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'dispatch:issue-reported',
        expect.objectContaining({
          orderId: 'order-1',
          reason: 'CUSTOMER_UNREACHABLE',
        }),
      );
    });

    it('V2-S2：状态非 ASSIGNED/PICKED_UP/DELIVERING → E-DISPATCH-004', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'DELIVERED', orderId: 'order-1' }),
      );

      await expect(
        service.reportIssue({ riderId: 'r1', taskId: 'task-1', reason: 'OTHER' }),
      ).rejects.toThrow(/cannot report issue/);
    });

    it('V2-S2：状态 PENDING_ASSIGN（未抢单）→ 拒绝', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PENDING_ASSIGN', orderId: 'order-1' }),
      );
      await expect(
        service.reportIssue({ riderId: 'r1', taskId: 'task-1', reason: 'OTHER' }),
      ).rejects.toThrow(/cannot report issue/);
    });
  });

  describe('createTaskForOrder - 幂等', () => {
    it('已存在 task → 直接返回，不重建', async () => {
      const existing = buildTask({ orderId: 'order-1' });
      mockDb.deliveryTask.findFirst.mockResolvedValue(existing);

      const result = await service.createTaskForOrder('order-1');

      expect(result?.id).toBe('task-1');
      expect(mockDb.deliveryTask.create).not.toHaveBeenCalled();
    });

    it('Order 不存在 → 抛 ORDER_NOT_FOUND', async () => {
      mockDb.deliveryTask.findFirst.mockResolvedValue(null);
      mockDb.order.findUnique.mockResolvedValue(null);

      await expect(service.createTaskForOrder('order-x')).rejects.toThrow(
        /ORDER_NOT_FOUND/,
      );
    });
  });

  // ==========================================================================
  // P14 ④ dispatch 集成：createTaskForReturn + pickupTask return 扩展 + startDelivering
  // 决策（2026-08-11 用户拍板 spec §七）：
  //   1. 新增 startDelivering（return 三步 PICKED_UP->DELIVERING->DELIVERED；delivery 两步跳过 DELIVERING）
  //   2. refund APPROVE 同步触发 createTaskForReturn（forwardRef 防循环）
  //   3. 复用抢单大厅（建任务 PENDING_ASSIGN + WS dispatch:new-task，骑手 acceptTask 抢）
  // ==========================================================================

  describe('createTaskForReturn - P14 ④ 退货取件任务创建', () => {
    // createTaskForReturn 用 refund.findUnique include order（含 warehouse），不调 db.order.findUnique
    const mockReturnRefund = {
      id: 'refund-1',
      orderId: 'order-1',
      userId: 'user-1',
      refundType: 'RETURN_REFUND',
      status: 'COMPLETED',
      amount: 10000,
      order: {
        id: 'order-1',
        orderNo: 'MM1',
        warehouseId: 'wh-1',
        deliveryAddress: { detail: 'Customer addr', lat: -8.55, lng: 125.55 },
        payableAmount: 10000,
        paymentMethod: 'COD',
        warehouse: {
          id: 'wh-1',
          code: 'W01',
          address: 'Wh 1 addr',
          centerLat: { toNumber: () => -8.5 },
          centerLng: { toNumber: () => 125.5 },
        },
      },
    };

    it('refund RETURN_REFUND + COMPLETED → 建 return task + WS 推 dispatch:new-task', async () => {
      mockDb.refund.findUnique.mockResolvedValue(mockReturnRefund);
      mockDb.deliveryTask.findFirst.mockResolvedValue(null);
      mockDb.deliveryTask.create.mockResolvedValue(
        buildTask({
          taskType: 'return',
          refundId: 'refund-1',
          status: 'PENDING_ASSIGN',
          pickupAddress: 'Customer addr',
          dropoffAddress: 'Wh 1 addr',
        }),
      );

      const result = await service.createTaskForReturn('refund-1');

      expect(result.taskType).toBe('return');
      expect(result.refundId).toBe('refund-1');
      expect(mockDb.deliveryTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskType: 'return',
            refundId: 'refund-1',
            orderId: 'order-1',
            status: 'PENDING_ASSIGN',
          }),
        }),
      );
      // WS 推 riders room（复用抢单大厅，决策 3）
      expect(mockServer.to).toHaveBeenCalledWith('riders');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'dispatch:new-task',
        expect.objectContaining({ taskId: 'task-1' }),
      );
    });

    it('refund 不存在 → E-REFUND-003 Refund not found', async () => {
      mockDb.refund.findUnique.mockResolvedValue(null);
      await expect(service.createTaskForReturn('refund-x')).rejects.toThrow(
        /Refund not found/,
      );
    });

    it('refund.refundType=REFUND_ONLY → E-DISPATCH-022 not RETURN_REFUND', async () => {
      mockDb.refund.findUnique.mockResolvedValue({
        ...mockReturnRefund,
        refundType: 'REFUND_ONLY',
      });
      await expect(service.createTaskForReturn('refund-1')).rejects.toThrow(
        /not RETURN_REFUND/,
      );
    });

    it('已有 return task → E-DISPATCH-021 already has return task', async () => {
      mockDb.refund.findUnique.mockResolvedValue(mockReturnRefund);
      mockDb.deliveryTask.findFirst.mockResolvedValue(
        buildTask({ taskType: 'return', refundId: 'refund-1' }),
      );
      await expect(service.createTaskForReturn('refund-1')).rejects.toThrow(
        /already has return task/,
      );
    });
  });

  describe('pickupTask - P14 ④ taskType=return 写 refund.pickupAt（事务内）', () => {
    it('taskType=return → withTransaction 内额外写 refund.pickupAt', async () => {
      const txRefundUpdate = vi.fn().mockResolvedValue({});
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'ASSIGNED',
          taskType: 'return',
          refundId: 'refund-1',
          orderId: 'order-1',
        }),
      );
      mockHelpers.withTransaction.mockImplementation(async (fn) =>
        fn({
          // P1-7：pickupTask 守卫翻转（乐观锁成功 count=1）
          $executeRaw: vi.fn().mockResolvedValue(1),
          deliveryTask: {
            update: vi
              .fn()
              .mockResolvedValue(
                buildTask({ riderId: 'r1', status: 'PICKED_UP', taskType: 'return', refundId: 'refund-1' }),
              ),
            findUnique: vi.fn().mockResolvedValue({ status: 'PICKED_UP' }),
          },
          order: { update: vi.fn().mockResolvedValue({}) },
          refund: { update: txRefundUpdate },
        }),
      );

      await service.pickupTask({ riderId: 'r1', taskId: 'task-1' });

      expect(txRefundUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'refund-1' },
          data: expect.objectContaining({ pickupAt: expect.any(Date) }),
        }),
      );
    });

    it('taskType=delivery → 不写 refund（负向，向后兼容）', async () => {
      const txRefundUpdate = vi.fn().mockResolvedValue({});
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'ASSIGNED',
          taskType: 'delivery',
          refundId: null,
          orderId: 'order-1',
        }),
      );
      mockHelpers.withTransaction.mockImplementation(async (fn) =>
        fn({
          // P1-7：pickupTask 守卫翻转（乐观锁成功 count=1）
          $executeRaw: vi.fn().mockResolvedValue(1),
          deliveryTask: {
            update: vi
              .fn()
              .mockResolvedValue(buildTask({ riderId: 'r1', status: 'PICKED_UP', taskType: 'delivery' })),
            findUnique: vi.fn().mockResolvedValue({ status: 'PICKED_UP' }),
          },
          order: { update: vi.fn().mockResolvedValue({}) },
          refund: { update: txRefundUpdate },
        }),
      );

      await service.pickupTask({ riderId: 'r1', taskId: 'task-1' });

      expect(txRefundUpdate).not.toHaveBeenCalled();
    });
  });

  describe('startDelivering - P14 ④ 打通 DELIVERING 死状态', () => {
    it('taskType=return + PICKED_UP → DELIVERING + 写 refund.pickedAt', async () => {
      const txRefundUpdate = vi.fn().mockResolvedValue({});
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({
          riderId: 'r1',
          status: 'PICKED_UP',
          taskType: 'return',
          refundId: 'refund-1',
          orderId: 'order-1',
        }),
      );
      mockHelpers.withTransaction.mockImplementation(async (fn) =>
        fn({
          deliveryTask: {
            update: vi
              .fn()
              .mockResolvedValue(
                buildTask({ riderId: 'r1', status: 'DELIVERING', taskType: 'return', refundId: 'refund-1' }),
              ),
          },
          refund: { update: txRefundUpdate },
        }),
      );

      const result = await service.startDelivering({ riderId: 'r1', taskId: 'task-1' });

      expect(result.status).toBe('DELIVERING');
      expect(txRefundUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'refund-1' },
          data: expect.objectContaining({ pickedAt: expect.any(Date) }),
        }),
      );
    });

    it('taskType=delivery → 拒绝 E-DISPATCH-020（delivery 走 deliverTask 不走 startDelivering）', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PICKED_UP', taskType: 'delivery', refundId: null }),
      );
      await expect(
        service.startDelivering({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toThrow(/delivery task|invalid taskType/i);
    });

    it('状态非 PICKED_UP → E-DISPATCH-004 cannot start delivering', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'ASSIGNED', taskType: 'return', refundId: 'refund-1' }),
      );
      await expect(
        service.startDelivering({ riderId: 'r1', taskId: 'task-1' }),
      ).rejects.toThrow(/cannot start delivering|E-DISPATCH-004/i);
    });
  });
});

// ===== 批A A4：事件通知挂点（2026-09-09）=====
describe('DispatchService - A4 事件通知挂点', () => {
  let service: DispatchService;
  // notify mock（记录调用 + 可控抛错验证失败容忍）
  const notify = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    notify.mockReset().mockResolvedValue(undefined);
    service = new DispatchService(mockRealtime as never, mockEligibility as never, { notify });
    Object.values(mockDb).forEach((table) => {
      if (typeof table === 'object') {
        Object.values(table).forEach((fn) => fn.mockReset?.());
      }
    });
    mockHelpers.withTransaction.mockReset();
    mockSalesIncrement.mockReset();
    mockLedgerWrite.mockReset();
    mockServer.to.mockClear();
    mockServer.emit.mockClear();
    mockDb.riderProfile.findUnique.mockResolvedValue({ id: 'r1', userId: 'user-rider-1' });
    mockEligibility.assertCanAccept.mockResolvedValue({ riderProfileId: 'r1', depositAmount: 100, maxOrderAmount: 1000, tierId: 'tier-1' });
  });

  it('挂点 3：deliverTask 送达 → notify(orderDelivered, ORDER_UPDATE, data.orderId)', async () => {
    mockDb.deliveryTask.findUnique.mockResolvedValue(
      buildTask({
        riderId: 'r1',
        status: 'PICKED_UP',
        orderId: 'order-1',
        order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', userId: 'user-customer-1' },
      }),
    );
    mockDb.deliveryTask.update.mockResolvedValue(buildTask({ riderId: 'r1', status: 'DELIVERED' }));
    mockHelpers.withTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
    );

    await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'orderDelivered',
        userId: 'user-customer-1',
        type: 'ORDER_UPDATE',
        data: expect.objectContaining({ orderId: 'order-1' }),
      }),
    );
  });

  it('挂点 4：acceptTask 抢单成功 → notify(taskAssigned, RIDER_TASK, data.taskId+orderId)', async () => {
    mockDb.deliveryTask.findUnique
      .mockResolvedValueOnce(buildTask()) // 第一次查 status
      .mockResolvedValueOnce(buildTask({ status: 'ASSIGNED' })); // 事务后查详情
    mockHelpers.withTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(1),
          order: { update: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      },
    );

    await service.acceptTask({ riderId: 'r1', taskId: 'task-1' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'taskAssigned',
        userId: 'r1',
        type: 'RIDER_TASK',
        data: expect.objectContaining({ taskId: 'task-1', orderId: 'order-1' }),
      }),
    );
  });

  it('挂点 5a：reportIssue → notify(taskFailed, RIDER_TASK, data.reason)', async () => {
    mockDb.deliveryTask.findUnique.mockResolvedValue(
      buildTask({ riderId: 'r1', status: 'PICKED_UP', orderId: 'order-1' }),
    );
    mockDb.order.findUnique.mockResolvedValue({ status: 'PICKED' });
    mockHelpers.withTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          deliveryTask: {
            update: vi.fn().mockResolvedValue(
              buildTask({ riderId: 'r1', status: 'FAILED' }),
            ),
          },
          orderEvent: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      },
    );

    await service.reportIssue({ riderId: 'r1', taskId: 'task-1', reason: 'CUSTOMER_UNREACHABLE' });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'taskFailed',
        userId: 'r1',
        type: 'RIDER_TASK',
        data: expect.objectContaining({ taskId: 'task-1', reason: 'CUSTOMER_UNREACHABLE' }),
      }),
    );
  });

  it('失败容忍契约：notify 内部吞错（与真 NotificationEventService 行为一致）→ deliverTask 不受影响', async () => {
    // 真实 NotificationEventService 全链 try/catch 永不 reject（内部测试见
    // notification-event.service.test.ts）；此处验证挂点调用方在 notify 正常
    // resolve（即使内部失败）时主流程完整走完
    mockDb.deliveryTask.findUnique.mockResolvedValue(
      buildTask({
        riderId: 'r1',
        status: 'PICKED_UP',
        orderId: 'order-1',
        order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', userId: 'user-customer-1' },
      }),
    );
    mockDb.deliveryTask.update.mockResolvedValue(buildTask({ riderId: 'r1', status: 'DELIVERED' }));
    mockHelpers.withTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
    );

    const result = await service.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });

    expect(result.status).toBe('DELIVERED');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notificationEvents = null（单测默认）→ 不触发挂点不抛错', async () => {
    const plain = new DispatchService(mockRealtime as never, mockEligibility as never, null);
    // 覆盖当前 describe 的 service 变量（只为本用例）
    mockDb.deliveryTask.findUnique.mockResolvedValue(
      buildTask({
        riderId: 'r1',
        status: 'PICKED_UP',
        orderId: 'order-1',
        order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD', userId: 'user-customer-1' },
      }),
    );
    mockDb.deliveryTask.update.mockResolvedValue(buildTask({ riderId: 'r1', status: 'DELIVERED' }));
    mockHelpers.withTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
    );

    const result = await plain.deliverTask({ riderId: 'r1', taskId: 'task-1', collectedAmount: 100 });

    expect(result.status).toBe('DELIVERED');
    expect(notify).not.toHaveBeenCalled();
  });
});
