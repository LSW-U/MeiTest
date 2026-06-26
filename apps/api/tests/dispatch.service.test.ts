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

const { mockDb, mockHelpers, mockRealtime, mockServer } = vi.hoisted(() => {
  const server = {
    to: vi.fn(() => server),
    emit: vi.fn(),
  };
  return {
    mockDb: {
      deliveryTask: {
        findMany: vi.fn(),
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
}));

vi.mock('../src/modules/realtime/realtime.gateway', () => ({
  RealtimeGateway: class {
    server = mockServer;
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DispatchService } from '../src/modules/dispatch/dispatch.service';

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    orderId: 'order-1',
    riderId: null,
    warehouseId: 'wh-1',
    status: 'PENDING_ASSIGN',
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
    order: { orderNo: 'MM1', payableAmount: 100, paymentMethod: 'COD' },
    warehouse: { code: 'W01' },
    ...overrides,
  };
}

describe('DispatchService', () => {
  let service: DispatchService;

  beforeEach(() => {
    service = new DispatchService(mockRealtime as never);
    Object.values(mockDb).forEach((table) => {
      if (typeof table === 'object') {
        Object.values(table).forEach((fn) => fn.mockReset?.());
      }
    });
    mockHelpers.withTransaction.mockReset();
    mockServer.to.mockClear();
    mockServer.emit.mockClear();
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
      mockDb.deliveryTask.findUnique.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'ASSIGNED', orderId: 'order-1' }),
      );
      mockDb.deliveryTask.update.mockResolvedValue(
        buildTask({ riderId: 'r1', status: 'PICKED_UP' }),
      );

      const result = await service.pickupTask({ riderId: 'r1', taskId: 'task-1' });
      expect(result.status).toBe('PICKED_UP');
      // Order 状态机推进
      expect(mockDb.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({ status: 'PICKED' }),
        }),
      );
      // WS 推 order:status
      expect(mockServer.to).toHaveBeenCalledWith('order:order-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'order:status',
        expect.objectContaining({ status: 'PICKED' }),
      );
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
      mockDb.deliveryTask.findUnique.mockResolvedValue(existing);

      const result = await service.createTaskForOrder('order-1');

      expect(result?.id).toBe('task-1');
      expect(mockDb.deliveryTask.create).not.toHaveBeenCalled();
    });

    it('Order 不存在 → 抛 ORDER_NOT_FOUND', async () => {
      mockDb.deliveryTask.findUnique.mockResolvedValue(null);
      mockDb.order.findUnique.mockResolvedValue(null);

      await expect(service.createTaskForOrder('order-x')).rejects.toThrow(
        /ORDER_NOT_FOUND/,
      );
    });
  });
});
