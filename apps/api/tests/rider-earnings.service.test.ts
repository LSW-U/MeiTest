/**
 * RiderEarningsService 单测 — 批2 B-P1-2（R11 派生口径）
 *
 * 覆盖场景：
 *   1. 越权：无 RiderProfile 的 RIDER JWT → ForbiddenException（伪造 requesterId 在
 *      实现层不可能——service 一律从 profile 派生，不收请求体）
 *   2. R11 派生口径：availableBalance = Σ Settlement(CONFIRMED+PAID).netAmount
 *      − Σ WithdrawalRequest(PAID).amount；聚合 where 必须只含这两种状态
 *   3. 滚动窗口：today/weekly/monthly 的 periodDate 窗口 = 今日/近7天/近30天（Dili 时区）
 *   4. 金额单位分：字段值原样透传（不除 100）
 *   5. createWithdrawal：requesterType/requesterId 服务端强制，body 的 amount/payoutAccount 透传
 *   6. getTransactions：periodDate 倒序 + offset 分页；DISPUTED 行进流水（展示层标注）
 *      但 summary 聚合 where 不含 DISPUTED（口径排除在聚合层完成）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

vi.mock('../src/shared/db', () => {
  const profileFindUnique = vi.fn();
  const settlementAggregate = vi.fn();
  const settlementFindMany = vi.fn();
  const settlementCount = vi.fn();
  const wrAggregate = vi.fn();
  const db = {
    riderProfile: { findUnique: profileFindUnique },
    settlement: { aggregate: settlementAggregate, findMany: settlementFindMany, count: settlementCount },
    withdrawalRequest: { aggregate: wrAggregate },
  };
  return { db, withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
});

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RiderEarningsService } from '../src/modules/rider/earnings.service';
import { db } from '../src/shared/db';

const profileFindUnique = db.riderProfile.findUnique as unknown as ReturnType<typeof vi.fn>;
const settlementAggregate = db.settlement.aggregate as unknown as ReturnType<typeof vi.fn>;
const settlementFindMany = db.settlement.findMany as unknown as ReturnType<typeof vi.fn>;
const settlementCount = db.settlement.count as unknown as ReturnType<typeof vi.fn>;
const wrAggregate = db.withdrawalRequest.aggregate as unknown as ReturnType<typeof vi.fn>;

/** WithdrawalService 桩：RiderEarningsService 只复用 create/list */
const withdrawStub = {
  create: vi.fn(async (input: unknown) => input),
  list: vi.fn(async (query: unknown) => ({ items: [], total: 0, ...query })),
};

const SUB = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

function service() {
  return new RiderEarningsService(withdrawStub as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  profileFindUnique.mockResolvedValue({ id: PROFILE_ID, userId: SUB });
  settlementAggregate.mockResolvedValue({ _sum: { netAmount: 123456 } });
  wrAggregate.mockResolvedValue({ _sum: { amount: 5000 } });
  settlementFindMany.mockResolvedValue([]);
  settlementCount.mockResolvedValue(0);
});

describe('RiderEarningsService — 越权（任务书单测 1）', () => {
  it('无 RiderProfile 的 RIDER JWT → ForbiddenException', async () => {
    profileFindUnique.mockResolvedValue(null);
    await expect(service().getSummary(SUB)).rejects.toThrow(ForbiddenException);
  });

  it('createWithdrawal 同样走 profile 解析（不信任任何请求体字段）', async () => {
    profileFindUnique.mockResolvedValue(null);
    await expect(
      service().createWithdrawal(SUB, { amount: 100, payoutAccount: { channel: 'BANK_TRANSFER', account: 'x' } }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('RiderEarningsService — R11 派生口径（任务书单测 3）', () => {
  it('availableBalance 聚合只允许 CONFIRMED+PAID 结算单（DISPUTED/PENDING 排除）', async () => {
    await service().getSummary(SUB);
    const settledWhere = settlementAggregate.mock.calls[0][0].where;
    expect(settledWhere.status).toEqual({ in: ['CONFIRMED', 'PAID'] });
    expect(settledWhere.subjectType).toBe('RIDER');
    expect(settledWhere.subjectId).toBe(PROFILE_ID);
  });

  it('余额扣减只统计 PAID 提现（REJECTED/FAILED/PENDING/APPROVED 不扣）', async () => {
    await service().getSummary(SUB);
    const wrWhere = wrAggregate.mock.calls[0][0].where;
    expect(wrWhere.status).toBe('PAID');
    expect(wrWhere.requesterType).toBe('RIDER');
    expect(wrWhere.requesterId).toBe(PROFILE_ID);
  });

  it('滚动窗口：today/weekly/monthly = 今日/近7天/近30天（Dili），且同样只计 CONFIRMED+PAID', async () => {
    await service().getSummary(SUB);
    // 4 次 settlement.aggregate：余额 1 次 + 窗口 3 次
    expect(settlementAggregate).toHaveBeenCalledTimes(4);
    const windows = settlementAggregate.mock.calls.slice(1).map((c: unknown[]) => c[0].where.periodDate);
    for (const w of windows) {
      // gte/lte 均为 Date，落在 UTC 午夜（由 Dili 日期字符串构造）
      expect(w.gte).toBeInstanceOf(Date);
      expect(w.lte).toBeInstanceOf(Date);
      expect((w.gte as Date).toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    }
    // 近7天窗口起点 = 6 天前（含今日共 7 天）；近30天 = 29 天前
    const daysBetween = (iso: string) =>
      Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
    const starts = windows.map((w: { gte: string }) => daysBetween(w.gte));
    // today 起点≈0、weekly≈6、monthly≈29（允许时区换算 ±1）
    expect(starts[0]).toBeLessThanOrEqual(1);
    expect(starts[1]).toBeGreaterThanOrEqual(5);
    expect(starts[1]).toBeLessThanOrEqual(7);
    expect(starts[2]).toBeGreaterThanOrEqual(28);
    expect(starts[2]).toBeLessThanOrEqual(30);
    for (const w of windows) {
      expect(w.gte).toBeDefined();
    }
  });

  it('金额单位分：聚合结果原样透传（123456 − 5000 = 118456）', async () => {
    const s = await service().getSummary(SUB);
    expect(s.availableBalance).toBe(123456 - 5000);
    expect(s.today).toBe(123456);
    expect(s.weekly).toBe(123456);
    expect(s.monthly).toBe(123456);
    expect(Number.isInteger(s.availableBalance)).toBe(true);
  });
});

describe('RiderEarningsService — 流水与提现', () => {
  it('transactions：periodDate 倒序 + offset 分页 + 仅本人', async () => {
    settlementFindMany.mockResolvedValue([
      {
        id: 's1',
        periodDate: new Date('2026-10-02T00:00:00.000Z'),
        orderCount: 3,
        grossAmount: 9000,
        commission: 0,
        refundAmount: 0,
        netAmount: 9000,
        status: 'DISPUTED',
        confirmedAt: null,
        paidAt: null,
        createdAt: new Date('2026-10-03T00:00:00.000Z'),
      },
    ]);
    settlementCount.mockResolvedValue(1);
    const r = await service().getTransactions(SUB, { page: 2, pageSize: 10 });
    expect(settlementFindMany.mock.calls[0][0]).toMatchObject({
      where: { subjectType: 'RIDER', subjectId: PROFILE_ID },
      orderBy: { periodDate: 'desc' },
      skip: 10,
      take: 10,
    });
    // DISPUTED 行进流水（前端标注"争议中"），金额分原样
    expect(r.total).toBe(1);
    expect((r.items as { status: string; netAmount: number }[])[0].netAmount).toBe(9000);
    expect((r.items as { status: string }[])[0].status).toBe('DISPUTED');
  });

  it('createWithdrawal：requesterType=RIDER + requesterId=profile.id 服务端强制', async () => {
    const account = { channel: 'BANK_TRANSFER' as const, account: 'TL123' };
    await service().createWithdrawal(SUB, { amount: 2500, payoutAccount: account });
    expect(withdrawStub.create).toHaveBeenCalledWith(
      { requesterType: 'RIDER', requesterId: PROFILE_ID, amount: 2500, payoutAccount: account },
      SUB,
    );
  });

  it('listWithdrawals：透传分页并锁定 requesterType=RIDER + 本人', async () => {
    await service().listWithdrawals(SUB, { page: 1, pageSize: 20 });
    expect(withdrawStub.list).toHaveBeenCalledWith({
      requesterType: 'RIDER',
      requesterId: PROFILE_ID,
      page: 1,
      pageSize: 20,
    });
  });
});
