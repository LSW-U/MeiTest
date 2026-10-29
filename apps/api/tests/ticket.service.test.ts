/**
 * TicketService / TicketNoService 单测（替换品批2 工单化，2026-10-29）
 *
 * 覆盖（任务书验收线）：
 *   - ticketNo 格式：TK + yyyyMMdd + 6 位序号 = 16 位；Redis 首次 INCR 设 2 天 TTL
 *   - D11 时限 key 链：类型覆盖 > 全局 > 代码默认(24/48)；非法配置降级
 *   - D19 幂等：同源（DELIVERY_ISSUE + taskId）重复建单返回既有票；并发 P2002 同样返回既有票
 *   - 归属：非本人 ticketNo 查询 → 404 防枚举
 *   - 时间线：按 createdAt asc + 游标分页
 *
 * mock：db（ticket/ticketEvent/systemConfig）+ redis
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../src/prisma/client';

const { mockDb, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    ticket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    ticketEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
    },
  },
  mockRedis: {
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { TicketNoService } from '../src/modules/ticket/ticket-no.service';
import {
  TicketService,
  DEFAULT_FIRST_RESPONSE_HOURS,
  DEFAULT_RESOLVE_HOURS,
} from '../src/modules/ticket/ticket.service';

function buildTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    ticketNo: 'TK20261029000001',
    status: 'OPEN',
    type: 'CUSTOMER_UNREACHABLE',
    sourceType: 'DELIVERY_ISSUE',
    sourceId: 'task-1',
    firstRespDue: new Date('2026-10-30T00:00:00Z'),
    resolveDue: new Date('2026-10-31T00:00:00Z'),
    escalated: false,
    userId: 'user-1',
    createdAt: new Date('2026-10-29T00:00:00Z'),
    updatedAt: new Date('2026-10-29T00:00:00Z'),
    ...overrides,
  };
}

describe('TicketNoService', () => {
  let svc: TicketNoService;
  beforeEach(() => {
    svc = new TicketNoService();
    mockRedis.incr.mockReset();
    mockRedis.expire.mockReset();
  });

  it('格式：TK + yyyyMMdd(Asia/Dili) + 6 位序号 = 16 位', async () => {
    mockRedis.incr.mockResolvedValue(1);
    const no = await svc.nextTicketNo();
    expect(no).toMatch(/^TK\d{8}\d{6}$/);
    expect(no).toHaveLength(16);
    expect(no.startsWith('TK2026')).toBe(true);
  });

  it('首次 INCR（seq=1）设置 2 天 TTL', async () => {
    mockRedis.incr.mockResolvedValue(1);
    await svc.nextTicketNo();
    expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringMatching(/^ticket:seq:\d{8}$/));
    expect(mockRedis.expire).toHaveBeenCalledWith(expect.any(String), 2 * 24 * 3600);
  });

  it('非首次 INCR 不重复设置 TTL', async () => {
    mockRedis.incr.mockResolvedValue(7);
    const no = await svc.nextTicketNo();
    expect(no.endsWith('000007')).toBe(true);
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });
});

describe('TicketService - D11 时限解析', () => {
  let svc: TicketService;
  beforeEach(() => {
    svc = new TicketService({ nextTicketNo: vi.fn().mockResolvedValue('TK20261029000001') } as never);
    mockDb.systemConfig.findUnique.mockReset();
  });

  it('类型覆盖 > 全局 > 代码默认（三层各自命中）', async () => {
    // 类型覆盖命中：resolve_hours.CUSTOMER_UNREACHABLE = 4
    mockDb.systemConfig.findUnique.mockImplementation(({ where: { key } }: { where: { key: string } }) => {
      if (key === 'ticket.resolve_hours.CUSTOMER_UNREACHABLE') {
        return Promise.resolve({ value: '4' });
      }
      return Promise.resolve(null);
    });
    const r = await svc.resolveDeadlines('CUSTOMER_UNREACHABLE');
    // resolve 走类型覆盖 4h；firstResp 无任何配置 → 代码默认 24h
    expect(r.resolveDue!.getTime() - Date.now()).toBeCloseTo(4 * 3600_000, -4);
    expect(r.firstRespDue!.getTime() - Date.now()).toBeCloseTo(DEFAULT_FIRST_RESPONSE_HOURS * 3600_000, -4);
  });

  it('全局配置命中（无类型覆盖）', async () => {
    mockDb.systemConfig.findUnique.mockImplementation(({ where: { key } }: { where: { key: string } }) => {
      if (key === 'ticket.first_response_hours') {
        return Promise.resolve({ value: '12' });
      }
      return Promise.resolve(null);
    });
    const r = await svc.resolveDeadlines('OTHER');
    expect(r.firstRespDue!.getTime() - Date.now()).toBeCloseTo(12 * 3600_000, -4);
    expect(r.resolveDue!.getTime() - Date.now()).toBeCloseTo(DEFAULT_RESOLVE_HOURS * 3600_000, -4);
  });

  it('非法配置（负数/非数字）降级代码默认', async () => {
    mockDb.systemConfig.findUnique.mockResolvedValue({ value: '-3' });
    const r = await svc.resolveDeadlines('OTHER');
    expect(r.firstRespDue!.getTime() - Date.now()).toBeCloseTo(DEFAULT_FIRST_RESPONSE_HOURS * 3600_000, -4);
    expect(r.resolveDue!.getTime() - Date.now()).toBeCloseTo(DEFAULT_RESOLVE_HOURS * 3600_000, -4);
  });
});

describe('TicketService - D19 幂等建单', () => {
  let svc: TicketService;
  beforeEach(() => {
    svc = new TicketService({ nextTicketNo: vi.fn().mockResolvedValue('TK20261029000002') } as never);
    mockDb.ticket.findUnique.mockReset();
    mockDb.ticket.create.mockReset();
    mockDb.systemConfig.findUnique.mockReset();
    mockDb.systemConfig.findUnique.mockResolvedValue(null);
  });

  it('已有同源票 → 直接返回既有票，不再 create', async () => {
    const existing = buildTicket();
    mockDb.ticket.findUnique.mockResolvedValueOnce(existing); // 幂等预查命中

    const result = await svc.createFromDeliveryIssue({ sourceId: 'task-1', userId: 'user-1', type: 'OTHER' });
    expect(result.ticketNo).toBe('TK20261029000001');
    expect(mockDb.ticket.create).not.toHaveBeenCalled();
  });

  it('新建票（含 CREATED 事件 + SYSTEM 操作人）', async () => {
    mockDb.ticket.findUnique
      .mockResolvedValueOnce(null) // 幂等预查未命中
      .mockResolvedValueOnce(null); // P2002 分支预查（不会走到）
    mockDb.ticket.create.mockResolvedValue(buildTicket({ ticketNo: 'TK20261029000002' }));

    const result = await svc.createFromDeliveryIssue({
      sourceId: 'task-2',
      userId: 'user-1',
      type: 'CUSTOMER_UNREACHABLE',
      note: '电话打不通',
    });
    expect(result.ticketNo).toBe('TK20261029000002');
    expect(mockDb.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'DELIVERY_ISSUE',
          sourceId: 'task-2',
          status: 'OPEN',
          events: {
            create: expect.objectContaining({ eventType: 'CREATED', operatorType: 'SYSTEM', note: '电话打不通' }),
          },
        }),
      }),
    );
  });

  it('并发窗口 P2002 → 返回既有票（race 兜底）', async () => {
    const existing = buildTicket();
    mockDb.ticket.findUnique
      .mockResolvedValueOnce(null) // 幂等预查未命中
      .mockResolvedValueOnce(existing); // race 后预查命中
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', { code: 'P2002', clientVersion: 'test' });
    mockDb.ticket.create.mockRejectedValue(p2002);

    const result = await svc.createFromDeliveryIssue({ sourceId: 'task-1', userId: 'user-1', type: 'OTHER' });
    expect(result.ticketNo).toBe('TK20261029000001');
  });

  it('非 P2002 错误原样抛出', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(null);
    mockDb.ticket.create.mockRejectedValue(new Error('db down'));
    await expect(
      svc.createFromDeliveryIssue({ sourceId: 'task-1', userId: 'user-1', type: 'OTHER' }),
    ).rejects.toThrow('db down');
  });
});

describe('TicketService - 用户查询', () => {
  let svc: TicketService;
  beforeEach(() => {
    svc = new TicketService({ nextTicketNo: vi.fn() } as never);
    mockDb.ticket.findUnique.mockReset();
    mockDb.ticket.findMany.mockReset();
    mockDb.ticketEvent.findMany.mockReset();
  });

  it('详情：非本人 → 404 防枚举（与不存在同错误）', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket({ userId: 'someone-else' }));
    await expect(svc.getTicketByNo('TK20261029000001', 'user-1')).rejects.toMatchObject({
      response: { code: 'E-TICKET-001' },
    });
  });

  it('详情：不存在 → 404', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(null);
    await expect(svc.getTicketByNo('TK00000000000000', 'user-1')).rejects.toMatchObject({
      response: { code: 'E-TICKET-001' },
    });
  });

  it('详情：本人 → 返回视图（含 ticketNo/时限）', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket());
    const t = await svc.getTicketByNo('TK20261029000001', 'user-1');
    expect(t.ticketNo).toBe('TK20261029000001');
    expect(t.firstRespDue).toBe('2026-10-30T00:00:00.000Z');
  });

  it('列表：游标分页（hasMore + nextCursor）', async () => {
    mockDb.ticket.findMany.mockResolvedValue([buildTicket(), buildTicket({ id: 'ticket-2' })]);
    const r = await svc.listUserTickets({ userId: 'user-1', limit: 1 });
    expect(r.hasMore).toBe(true);
    expect(r.nextCursor).toBe('ticket-1');
    expect(r.items).toHaveLength(1);
  });

  it('时间线：按 createdAt asc 排序', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket());
    mockDb.ticketEvent.findMany.mockResolvedValue([
      { id: 'ev-1', ticketId: 'ticket-1', eventType: 'CREATED', operatorType: 'SYSTEM', operatorId: null, note: null, createdAt: new Date('2026-10-29T00:00:00Z') },
    ]);
    const r = await svc.listTicketEvents({ ticketNo: 'TK20261029000001', userId: 'user-1' });
    expect(mockDb.ticketEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
    );
    expect(r.items[0]!.eventType).toBe('CREATED');
  });

  it('时间线：非本人 → 404', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket({ userId: 'someone-else' }));
    await expect(
      svc.listTicketEvents({ ticketNo: 'TK20261029000001', userId: 'user-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-TICKET-001' } });
  });
});

// ============================================================================
// 批3（2026-10-30 D18/D22）：admin 查询 / 状态流转 / 超时升级
// ============================================================================

describe('TicketService - admin（批3 D22）', () => {
  let svc: TicketService;
  beforeEach(() => {
    svc = new TicketService({ nextTicketNo: vi.fn() } as never);
    mockDb.ticket.findUnique.mockReset();
    mockDb.ticket.findMany.mockReset();
    mockDb.ticket.update.mockReset();
    mockDb.ticketEvent.create.mockReset();
  });

  it('admin 列表：游标分页 + escalated 筛选透传', async () => {
    mockDb.ticket.findMany.mockResolvedValue([buildTicket({ escalated: true })]);
    const r = await svc.listAdminTickets({ escalated: true, limit: 1 });
    expect(mockDb.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { escalated: true } }),
    );
    expect(r.items[0]).toMatchObject({ escalated: true, userId: 'user-1', ticketNo: 'TK20261029000001' });
  });

  it('admin 详情：不存在 → 404；存在 → 返回含 escalated/userId/events（P2-1 内联时间线）', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(null);
    await expect(svc.getAdminTicketByNo('TK00000000000000')).rejects.toMatchObject({
      response: { code: 'E-TICKET-001' },
    });
    mockDb.ticket.findUnique.mockResolvedValue({
      ...buildTicket({ escalated: true }),
      events: [
        { id: 'ev-1', ticketId: 'ticket-1', eventType: 'CREATED', operatorType: 'SYSTEM', operatorId: null, note: null, createdAt: new Date('2026-10-29T00:00:00Z') },
      ],
    });
    const t = await svc.getAdminTicketByNo('TK20261029000001');
    expect(t.escalated).toBe(true);
    expect(t.events).toHaveLength(1);
    expect(t.events[0]!.eventType).toBe('CREATED');
  });

  it('状态流转合法：OPEN→IN_PROGRESS（写 TicketEvent ADMIN）', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket({ status: 'OPEN' }));
    mockDb.ticket.update.mockResolvedValue(buildTicket({ status: 'IN_PROGRESS' }));
    const t = await svc.updateTicketStatus({ ticketNo: 'TK20261029000001', action: 'IN_PROGRESS', operatorId: 'admin-1' });
    expect(t.status).toBe('IN_PROGRESS');
    expect(mockDb.ticketEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'STATUS_CHANGED', operatorType: 'ADMIN', operatorId: 'admin-1' }),
      }),
    );
  });

  it('状态流转非法：OPEN→RESOLVED 跳态 → 409 E-TICKET-002', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket({ status: 'OPEN' }));
    await expect(
      svc.updateTicketStatus({ ticketNo: 'TK20261029000001', action: 'RESOLVED', operatorId: 'admin-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-TICKET-002' } });
  });

  it('状态流转非法：CLOSED 终态再动 → 409 E-TICKET-002', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket({ status: 'CLOSED' }));
    await expect(
      svc.updateTicketStatus({ ticketNo: 'TK20261029000001', action: 'IN_PROGRESS', operatorId: 'admin-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-TICKET-002' } });
  });

  it('状态流转同态 → 400 E-TICKET-003', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(buildTicket({ status: 'IN_PROGRESS' }));
    await expect(
      svc.updateTicketStatus({ ticketNo: 'TK20261029000001', action: 'IN_PROGRESS', operatorId: 'admin-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-TICKET-003' } });
  });

  it('escalateTicket：首次置位（updateMany count=1 + ESCALATED SYSTEM 事件）', async () => {
    mockDb.ticket.updateMany.mockResolvedValue({ count: 1 });
    const first = await svc.escalateTicket('ticket-1');
    expect(first).toBe(true);
    // P3-1：原子幂等——updateMany where 带 escalated:false 条件，非先查后写
    expect(mockDb.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ticket-1', escalated: false },
        data: { escalated: true },
      }),
    );
    expect(mockDb.ticketEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'ESCALATED', operatorType: 'SYSTEM' }),
      }),
    );
  });

  it('escalateTicket 幂等：count=0（已被并发实例置位/不存在）→ false 不写事件', async () => {
    mockDb.ticket.updateMany.mockResolvedValue({ count: 0 });
    const first = await svc.escalateTicket('ticket-1');
    expect(first).toBe(false);
    expect(mockDb.ticketEvent.create).not.toHaveBeenCalled();
  });

  it('admin 详情：内联时间线 events 全量 asc（P2-1）', async () => {
    mockDb.ticket.findUnique.mockResolvedValue({
      ...buildTicket({ escalated: true }),
      events: [
        { id: 'ev-1', ticketId: 'ticket-1', eventType: 'CREATED', operatorType: 'SYSTEM', operatorId: null, note: null, createdAt: new Date('2026-10-29T00:00:00Z') },
        { id: 'ev-2', ticketId: 'ticket-1', eventType: 'STATUS_CHANGED', operatorType: 'ADMIN', operatorId: 'admin-1', note: 'STATUS: OPEN -> IN_PROGRESS', createdAt: new Date('2026-10-29T01:00:00Z') },
      ],
    });
    const t = await svc.getAdminTicketByNo('TK20261029000001');
    // include events asc 断言（一次取数免分页）
    expect(mockDb.ticket.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ticketNo: 'TK20261029000001' },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      }),
    );
    expect(t.escalated).toBe(true);
    expect(t.events).toHaveLength(2);
    expect(t.events[0]!.eventType).toBe('CREATED');
    expect(t.events[1]!.operatorType).toBe('ADMIN');
    expect(t.events[1]!.createdAt).toBe('2026-10-29T01:00:00.000Z');
  });
});
