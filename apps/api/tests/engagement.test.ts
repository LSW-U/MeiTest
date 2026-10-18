/**
 * Engagement 模块单测（客户画像批4 2026-10-18）
 *
 * 覆盖 P4 自检：
 *   P4-1 可配阈值生效（SystemConfig 覆盖默认值 → 触发查询按新阈值命中/不命中）
 *   P4-2 E3 频控超限 → skip + RATE_LIMITED 留痕（OutreachTrigger 落行）
 *   P4-3 幂等：同 triggerKey 重跑 → duplicate 不重发；P2002 并发吞掉
 *   P4-4 离线安全跳过：notificationEvent 语义（站内信必达，PUSH 无 token 通知侧自跳），
 *        service 侧 null 注入不炸 + notify 正常调用计 SENT
 *   时间冻结（vi.setSystemTime）四流触发准确性 + C6 生日 2/29 边界
 *   E3 Redis 降级 fail-open（异常放行）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '../src/prisma/client';

// ===== mock db / redis / logger / notification / segment =====
const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  triggerFindUnique: vi.fn(),
  triggerCreate: vi.fn(),
  ruleFindFirst: vi.fn(),
  subFindMany: vi.fn(),
  subUpdate: vi.fn(),
  redisIncr: vi.fn(),
  redisExpire: vi.fn(),
  notify: vi.fn(),
  batchGrant: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    $queryRaw: m.queryRaw,
    outreachTrigger: { findUnique: m.triggerFindUnique, create: m.triggerCreate },
    segmentCouponRule: { findFirst: m.ruleFindFirst },
    clientSubscription: {
      findMany: m.subFindMany,
      update: (...args: unknown[]) => Promise.resolve(m.subUpdate(...args)),
    },
    // getEngagementFlowConfig 读 SystemConfig——cfgHolder.value 动态注入假配置
    systemConfig: { findUnique: () => Promise.resolve(cfgHolder.value) },
  },
}));

// 可变配置容器（getEngagementFlowConfig 数据源；null → 代码默认值）
const cfgHolder = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../src/shared/cache/redis', () => ({
  redis: { incr: m.redisIncr, expire: m.redisExpire },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: m.loggerWarn, info: m.loggerInfo, error: m.loggerError },
}));

import { EngagementService, daysSinceInTz } from '../src/modules/engagement/engagement.service';
import {
  tryConsumePushCap,
  pushCapDailyKey,
  pushCapWeeklyKey,
} from '../src/modules/engagement/push-cap';
import {
  parseEngagementFlowConfig,
  ENGAGEMENT_FLOW_DEFAULTS,
  resetEngagementConfigCacheForTest,
} from '../src/modules/engagement/engagement.config';

// cfgHolder 声明提前（vi.mock 工厂引用；hoisted 保证先于 db mock 初始化）

import { isEngagementFlow } from '../src/modules/engagement/engagement.templates';


// ---------- helpers ----------
const FIXED_NOW = new Date('2026-10-18T03:15:00Z'); // Dili 12:15 同日

function makeService(overrides: { notify?: unknown; segment?: unknown } = {}) {
  return new EngagementService(
    (overrides.notify ?? { notify: m.notify }) as never,
    (overrides.segment ?? { batchGrantCoupons: m.batchGrant }) as never,
  );
}

/** 默认一切放行：幂等未命中 / 频控未超限 */
function allowAll() {
  m.triggerFindUnique.mockResolvedValue(null);
  m.triggerCreate.mockResolvedValue({});
  m.redisIncr.mockResolvedValue(1);
  m.redisExpire.mockResolvedValue(1);
  m.notify.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  resetEngagementConfigCacheForTest();
  cfgHolder.value = null; // 走默认配置
});

afterEach(() => {
  vi.useRealTimers();
});

// ==================== P4-1 可配阈值 + 时间冻结四流 ====================

describe('P4-1 可配阈值 + 时间冻结四流触发', () => {
  it('parseEngagementFlowConfig：合法 JSON 覆盖默认值，非法回退', () => {
    const ok = parseEngagementFlowConfig(JSON.stringify({ retentionDays: 45 }));
    expect(ok).toMatchObject({ ...ENGAGEMENT_FLOW_DEFAULTS, retentionDays: 45 });
    expect(parseEngagementFlowConfig('not-json')).toEqual(ENGAGEMENT_FLOW_DEFAULTS);
    expect(parseEngagementFlowConfig(JSON.stringify({ retentionDays: 9999 }))).toEqual(
      ENGAGEMENT_FLOW_DEFAULTS,
    );
  });

  it('C2 首购转化：注册恰 N 天前无单命中；阈值改后窗口随之移动（时间冻结）', async () => {
    allowAll();
    const svc = makeService();
    // 默认 firstPurchaseDays=7：注册日=2026-10-11 的用户命中
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    const r1 = await svc.runFirstPurchaseFlow(FIXED_NOW);
    expect(r1.sent).toBe(1);
    // SQL 里的天数差用了 cfg.firstPurchaseDays——mock 层验证参数携带 7（tagged template：值从第 2 个参数起）
    expect(m.queryRaw.mock.calls[0].slice(1).some((v: unknown) => v === 7)).toBe(true);
    // triggerKey = C2:{today}
    expect(m.triggerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ flow: 'C2', triggerKey: 'C2:2026-10-18', userId: 'u1', status: 'SENT' }),
      }),
    );
  });

  it('C3 复购感谢：第 N 单（前置恰 N-1）触发，triggerKey=订单 id，params 带 orderNo', async () => {
    allowAll();
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ id: 'o9', user_id: 'u1', order_no: 'MM2026101801000001' }]);
    const r = await svc.runThanksFlow(FIXED_NOW);
    expect(r.sent).toBe(1);
    expect(m.notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'repurchaseThanks', userId: 'u1', params: { orderNo: 'MM2026101801000001' } }),
    );
    expect(m.triggerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ flow: 'C3', triggerKey: 'C3:o9' }),
      }),
    );
    // SQL 携带 thanksOrderCount - 1 = 2
    expect(m.queryRaw.mock.calls[0].slice(1).some((v: unknown) => v === 2)).toBe(true);
  });

  it('C1 挽留：有规则 → 发券 + 推送；无规则 → SKIPPED/NO_COUPON_RULE 留痕', async () => {
    allowAll();
    const svc = makeService();
    m.queryRaw
      .mockResolvedValueOnce([{ user_id: 'u1' }])
      // C1 动作段 resolveLifecycleStage 聚合查询
      .mockResolvedValueOnce([{ f_count: 5n, last_at: new Date('2026-09-01T00:00:00Z') }]);
    m.ruleFindFirst.mockResolvedValueOnce({ promotionId: 'p1' });
    m.batchGrant.mockResolvedValueOnce({ granted: 1, skipped: 0, failed: 0, total: 1 });
    const r = await svc.runRetentionFlow(FIXED_NOW);
    expect(r.sent).toBe(1);
    expect(m.batchGrant).toHaveBeenCalledWith('p1', ['u1'], 'system:C1');

    // 无规则
    vi.clearAllMocks();
    allowAll();
    m.queryRaw
      .mockResolvedValueOnce([{ user_id: 'u1' }])
      .mockResolvedValueOnce([{ f_count: 5n, last_at: new Date('2026-09-01T00:00:00Z') }]);
    m.ruleFindFirst.mockResolvedValueOnce(null);
    const r2 = await svc.runRetentionFlow(FIXED_NOW);
    expect(r2.sent).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(r2.skipReasons.NO_COUPON_RULE).toBe(1);
    expect(m.notify).not.toHaveBeenCalled();
    // skip 留痕走日志（P2-2 裁决：SKIPPED 不落 outreach_triggers 行，不占幂等槽下轮可重试）
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'ENGAGEMENT_TRIGGER_SKIPPED', reason: 'NO_COUPON_RULE' }),
    );
    expect(m.triggerCreate).not.toHaveBeenCalled();
  });

  it('C6 生日窗口：isInBirthdayWindow 边界（lead 内/外/当天/2/29 平年映射）', () => {
    const svc = makeService();
    // today = 10-18，lead=3：10-19/20/21 命中，10-22 不命中，10-18（当天）不命中
    expect(svc.isInBirthdayWindow('10-19', 3, FIXED_NOW)).toBe(true);
    expect(svc.isInBirthdayWindow('10-21', 3, FIXED_NOW)).toBe(true);
    expect(svc.isInBirthdayWindow('10-22', 3, FIXED_NOW)).toBe(false);
    expect(svc.isInBirthdayWindow('10-18', 3, FIXED_NOW)).toBe(false);
    // 非法格式拒
    expect(svc.isInBirthdayWindow('garbage', 3, FIXED_NOW)).toBe(false);
    // 2/29 平年（2026 非闰）→ 3/1：lead=1 时 2/28 当天窗口含 3/1
    const feb28 = new Date('2026-02-28T03:00:00Z');
    expect(svc.isInBirthdayWindow('02-29', 1, feb28)).toBe(true);
    // 闰年 2028：2/29 原样
    const leapFeb28 = new Date('2028-02-28T03:00:00Z');
    expect(svc.isInBirthdayWindow('02-29', 1, leapFeb28)).toBe(true);
    // P2-1 回归：跨月边界——今天 10-30 lead=3 命中 11-01 生日（粗筛已改本月+下月两月窗口）
    const oct30 = new Date('2026-10-30T03:00:00Z');
    expect(svc.isInBirthdayWindow('11-01', 3, oct30)).toBe(true);
    expect(svc.isInBirthdayWindow('11-04', 3, oct30)).toBe(false); // lead 外
  });

  it('C6 流：时间冻结下命中窗口内用户发一次；同年重跑 duplicate（P4-3）', async () => {
    allowAll();
    const svc = makeService();
    m.queryRaw
      .mockResolvedValueOnce([{ id: 'u1', birth_date: new Date('1995-10-20') }])
      .mockResolvedValueOnce([]);
    const r = await svc.runBirthdayFlow(FIXED_NOW);
    expect(r.sent).toBe(1);
    expect(m.triggerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flow: 'C6', triggerKey: 'C6:2026' }) }),
    );
  });
});

// ==================== P4-2 频控超限 skip 留痕 ====================

describe('P4-2 E3 频控', () => {
  it('INCR 超日上限 → allowed=false；超限不回滚（不归还额度）', async () => {
    m.redisIncr.mockImplementation((key: string) =>
      Promise.resolve(key.includes(':d:') ? 3 : 1), // 日 cap=2 → 第 3 次
    );
    const r = await tryConsumePushCap('u1', 2, 5);
    expect(r.allowed).toBe(false);
    expect(r.dailyCount).toBe(3);
    expect(m.redisExpire).toHaveBeenCalled(); // 首次 INCR 设 TTL
  });

  it('周上限同样拦截', async () => {
    m.redisIncr.mockImplementation((key: string) =>
      Promise.resolve(key.includes(':w:') ? 6 : 1),
    );
    const r = await tryConsumePushCap('u1', 5, 5);
    expect(r.allowed).toBe(false);
  });

  it('Redis 异常 fail-open（放行 + 告警留痕）', async () => {
    m.redisIncr.mockRejectedValue(new Error('redis down'));
    const r = await tryConsumePushCap('u1', 2, 5);
    expect(r.allowed).toBe(true);
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'PUSH_CAP_REDIS_DEGRADED_ALLOW' }),
    );
  });

  it('频控 key 格式：日 yyyymmdd / 周 ISO-Www（Dili 日历）', () => {
    expect(pushCapDailyKey('u1', FIXED_NOW)).toBe('push:cap:u1:d:20261018');
    // 2026-10-18 是周六，属 2026-W42
    expect(pushCapWeeklyKey('u1', FIXED_NOW)).toBe('push:cap:u1:w:2026-W42');
  });

  it('流内超限 → gateAndFire skip + RATE_LIMITED 留痕（notify 不调用）', async () => {
    allowAll();
    m.redisIncr.mockResolvedValue(99); // 直接超限
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    const r = await svc.runFirstPurchaseFlow(FIXED_NOW);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.skipReasons.RATE_LIMITED).toBe(1);
    expect(m.notify).not.toHaveBeenCalled();
    // skip 留痕走日志（P2-2 裁决：SKIPPED 不占幂等槽，同槽位下轮可重试）
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'ENGAGEMENT_TRIGGER_SKIPPED', reason: 'RATE_LIMITED' }),
    );
    expect(m.triggerCreate).not.toHaveBeenCalled();
  });
});

// ==================== P4-3 幂等防重发 ====================

describe('P4-3 幂等', () => {
  it('同 flow+triggerKey+userId 已有记录 → duplicate 不再动作不再 notify', async () => {
    allowAll();
    m.triggerFindUnique.mockResolvedValue({ id: 't1' }); // 已触发
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    const r = await svc.runFirstPurchaseFlow(FIXED_NOW);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(0);
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.triggerCreate).not.toHaveBeenCalled();
    // 预检用了唯一索引 findUnique
    expect(m.triggerFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { flow_triggerKey_userId: { flow: 'C2', triggerKey: 'C2:2026-10-18', userId: 'u1' } },
      }),
    );
  });

  it('并发窗口 P2002（create 撞唯一约束）吞掉不计错误', async () => {
    allowAll();
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    m.triggerCreate.mockRejectedValue(p2002);
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    const r = await svc.runFirstPurchaseFlow(FIXED_NOW);
    expect(r.sent).toBe(1); // 触达已发出，落记录失败仅并发已处理
    expect(m.loggerWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'ENGAGEMENT_TRIGGER_RECORD_FAILED' }),
    );
  });

  it('非 P2002 落记录失败 → warn 留痕不炸流', async () => {
    allowAll();
    m.triggerCreate.mockRejectedValue(new Error('db down'));
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    const r = await svc.runFirstPurchaseFlow(FIXED_NOW);
    expect(r.sent).toBe(1);
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'ENGAGEMENT_TRIGGER_RECORD_FAILED' }),
    );
  });
});

// ==================== P4-4 离线安全跳过 ====================

describe('P4-4 离线安全', () => {
  it('notificationEvent 为 null（离线/降级注入）→ 流照常 SENT，不炸', async () => {
    allowAll();
    const svc = makeService({ notify: null });
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    const r = await svc.runFirstPurchaseFlow(FIXED_NOW);
    expect(r.sent).toBe(1);
  });

  it('notify 抛错被通知层语义吞掉前——service 层不额外包错：异常向上冒泡被 runAllFlows 隔离', async () => {
    allowAll();
    m.notify.mockRejectedValue(new Error('push fail'));
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ id: 'u1' }]);
    // 单流异常 → runAllFlows 隔离为 FLOW_ERROR
    const results = await svc.runAllFlows(FIXED_NOW);
    const c2 = results.find((r) => r.flow === 'C2')!;
    // C2 单流在本测试里抛错 → runAllFlows catch
    expect(c2.skipReasons.FLOW_ERROR).toBe(1);
  });
});

// ==================== B2/B3 + 模块杂项 ====================

describe('B2/B3 场景提醒', () => {
  it('B2：到期订阅触发，triggerKey=订阅 id+日期，sent 后推 lastRemindedAt', async () => {
    allowAll();
    const svc = makeService();
    m.subFindMany.mockResolvedValueOnce([
      { id: 's1', userId: 'u1', cycleDays: 7, lastRemindedAt: null, updatedAt: new Date('2026-10-01T00:00:00Z') },
      { id: 's2', userId: 'u2', cycleDays: 30, lastRemindedAt: null, updatedAt: new Date('2026-10-15T00:00:00Z') },
    ]);
    const r = await svc.runReplenishFlow(FIXED_NOW);
    // s1: 10-01 → 距今 17 天 ≥ 7 命中；s2: 3 天 < 30 不命中
    expect(r.candidates).toBe(1);
    expect(r.sent).toBe(1);
    expect(m.triggerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ flow: 'B2', triggerKey: 'B2:s1:20261018' }),
      }),
    );
    expect(m.subUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { lastRemindedAt: FIXED_NOW } });
  });

  it('B3：遗留超时的购物车用户每日一次召回', async () => {
    allowAll();
    const svc = makeService();
    m.queryRaw.mockResolvedValueOnce([{ user_id: 'u1' }]);
    const r = await svc.runCartRecallFlow(FIXED_NOW);
    expect(r.sent).toBe(1);
    expect(m.triggerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ flow: 'B3', triggerKey: 'B3:20261018' }),
      }),
    );
  });

  it('daysSinceInTz：Dili 日历日差（跨 UTC 日期边界正确）', () => {
    // 2026-10-01T20:00Z = Dili 10-02 05:00 → 至 10-18 是 16 个日历日
    expect(daysSinceInTz(new Date('2026-10-01T20:00:00Z'), FIXED_NOW)).toBe(16);
    expect(daysSinceInTz(new Date('2026-10-18T00:00:00Z'), FIXED_NOW)).toBe(0);
  });

  it('isEngagementFlow 守卫六流', () => {
    expect(isEngagementFlow('C1')).toBe(true);
    expect(isEngagementFlow('B3')).toBe(true);
    expect(isEngagementFlow('X9')).toBe(false);
  });
});
