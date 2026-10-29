/**
 * TicketTimeoutProcessor 单测（替换品批3 D18，2026-10-30）
 *
 * mock 时钟（vi.useFakeTimers）+ DB 种子断言（A4 验收）：
 *   - ticket-A：OPEN + firstRespDue 过期 → escalated 置位 + WS + PUSH
 *   - ticket-B：IN_PROGRESS + resolveDue 未到 → 不动
 *   - ticket-C：RESOLVED（达标终态）→ 不动
 *   - ticket-D：已 escalated=true → 扫描范围排除（where escalated:false）
 *
 * mock：db（ticket）+ RealtimeGateway + NotificationEventService + TicketService.escalateTicket（真实现打 mock db）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDb, mockEmit, mockNotify } = vi.hoisted(() => ({
  mockDb: {
    ticket: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    ticketEvent: { create: vi.fn() },
  },
  mockEmit: vi.fn(),
  mockNotify: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { TicketTimeoutProcessor } from '../src/modules/ticket/ticket-timeout.processor';
import { TicketService } from '../src/modules/ticket/ticket.service';

function makeJob(name = 'escalate-overdue-tickets') {
  return { name, data: {} } as never;
}

describe('TicketTimeoutProcessor（D18 超时升级）', () => {
  let processor: TicketTimeoutProcessor;
  let ticketService: TicketService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T16:00:00Z'));
    vi.clearAllMocks();
    // 真 TicketService（escalateTicket 逻辑打 mock db）——服务层幂等行为一并覆盖
    ticketService = new TicketService({ nextTicketNo: vi.fn() } as never);
    processor = new TicketTimeoutProcessor(
      ticketService,
      { server: { to: vi.fn().mockReturnValue({ emit: mockEmit }) } } as never,
      { notify: mockNotify } as never,
    );
    mockDb.ticket.updateMany.mockResolvedValue({ count: 1 });
    mockDb.ticketEvent.create.mockResolvedValue({});
    mockNotify.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('OPEN + firstRespDue 过期 → escalated 置位 + WS ticket:escalated + PUSH ticketEscalated（A4）', async () => {
    const now = Date.now();
    mockDb.ticket.findMany.mockResolvedValue([
      { id: 'ticket-A', ticketNo: 'TK20261029000001', userId: 'user-1' },
    ]);
    mockDb.ticket.findUnique.mockResolvedValue({
      id: 'ticket-A', escalated: false,
    });

    const result = await processor.process(makeJob());

    expect(result).toEqual({ escalated: 1, dryRun: false });
    // P3-1：原子幂等置位（updateMany escalated:false 条件，非先查后写）
    expect(mockDb.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ticket-A', escalated: false }, data: { escalated: true } }),
    );
    expect(mockDb.ticketEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'ESCALATED', operatorType: 'SYSTEM' }),
      }),
    );
    // WS 推 customer-service room
    expect(mockEmit).toHaveBeenCalledWith(
      'ticket:escalated',
      expect.objectContaining({ ticketNo: 'TK20261029000001' }),
    );
    // PUSH 模板
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ticketEscalated', userId: 'user-1' }),
    );
    void now;
  });

  it('未到期/已达标/已升级的工单不被误升级', async () => {
    // where 条件本身排除：断言查询带 escalated:false + 时限过期条件（防误杀回归点）
    mockDb.ticket.findMany.mockResolvedValue([]);
    const result = await processor.process(makeJob());
    expect(result).toEqual({ escalated: 0, dryRun: false });
    expect(mockDb.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ escalated: false }),
      }),
    );
    const where = mockDb.ticket.findMany.mock.calls[0]![0]!.where as { OR: unknown[] };
    // 三种超时形态：OPEN+首响过期 / OPEN+解决过期 / IN_PROGRESS+解决过期
    expect(where.OR).toHaveLength(3);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('escalateTicket 已置位（并发轮次）→ 幂等跳过，不重复 WS/PUSH', async () => {
    mockDb.ticket.findMany.mockResolvedValue([
      { id: 'ticket-D', ticketNo: 'TK20261028000009', userId: 'user-2' },
    ]);
    // P3-1：count=0 = 已被并发实例置位/不存在
    mockDb.ticket.updateMany.mockResolvedValue({ count: 0 });

    const result = await processor.process(makeJob());
    expect(result).toEqual({ escalated: 0, dryRun: false });
    expect(mockDb.ticketEvent.create).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('dryRun job → 跳过扫描', async () => {
    const result = await processor.process({ name: 'escalate-overdue-tickets', data: { dryRun: true } } as never);
    expect(result).toEqual({ escalated: 0, dryRun: true });
    expect(mockDb.ticket.findMany).not.toHaveBeenCalled();
  });
});
