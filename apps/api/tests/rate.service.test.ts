/**
 * RateService / 汇率快照钩子 单测（批A 汇率体系，微信支付预留 2026-09-08）
 *
 * 覆盖（任务书批A 验收 A6，≥6 项）：
 *   1. upsert：按日 upsert（十进制 7.2345 → 万分位 72345 落库 + operatorId 透传）
 *   2. upsert 校验：非真实日历日（02-30）→ E-RATE-002 / rate 区间非法 → E-RATE-001
 *   3. 当日查询：有表 → OPERATOR + 万分位原值返回
 *   4. 兜底回退：当日无表 → EXCHANGE_FALLBACK_RATE(7.2) + source=FALLBACK
 *   5. 快照写入：人民币通道 buildOrderRateFields 组装（1000 分 × 72345 → 7235 分）
 *   6. 非人民币单不写快照：resolveOrderEffectiveRate('COD') → null 且不查库；
 *      WECHAT_GLOBAL / ALIPAY_CN（枚举批B 补位）按字符串集合命中
 *   7. 精度（万分位换算）：toRateInt/fromRateInt 往返 + calcCnyAmount 四舍五入
 *   8. 历史列表：游标分页（take limit+1 → nextCursor）
 *   9. 契约 schema safeParse（controller zod 测试盲区按规约直测 schema）
 *
 * mock：db（exchangeRate）+ logger；getDaysAgoInTz 固定 2026-09-08（业务日确定性）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockLogger } = vi.hoisted(() => ({
  mockDb: {
    exchangeRate: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/logger/logger', () => ({ logger: mockLogger }));
vi.mock('../src/shared/datetime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/datetime')>();
  return { ...actual, getDaysAgoInTz: vi.fn(() => '2026-09-08') };
});

import {
  getEffectiveRate,
  resolveOrderEffectiveRate,
  buildOrderRateFields,
  upsertRate,
  listRates,
  rateDateToUtc,
} from '../src/modules/rate/rate.service';
import {
  toRateInt,
  fromRateInt,
  calcCnyAmount,
  isCnyPaymentMethod,
  EXCHANGE_FALLBACK_RATE,
} from '../src/modules/rate/rate.config';
import {
  UpsertExchangeRateRequest,
  ClientExchangeRateQuery,
  ListExchangeRatesQuery,
} from '@meimart/api-contract';

/** 满足 upsert 返回的行（万分位 72345 = 7.2345） */
function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rate-1',
    rateDate: rateDateToUtc('2026-09-08'),
    fromCurrency: 'USD',
    toCurrency: 'CNY',
    rate: 72345,
    source: 'OPERATOR',
    operatorId: 'admin-1',
    createdAt: new Date('2026-09-08T01:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('upsertRate（admin 按日维护）', () => {
  it('十进制 7.2345 → 万分位 72345 落库 + operatorId 透传 + source=OPERATOR', async () => {
    mockDb.exchangeRate.upsert.mockResolvedValue(buildRow());

    const view = await upsertRate({ rateDate: '2026-09-08', rate: 7.2345, operatorId: 'admin-1' });

    expect(mockDb.exchangeRate.upsert).toHaveBeenCalledTimes(1);
    const arg = mockDb.exchangeRate.upsert.mock.calls[0][0];
    expect(arg.where.rateDate_fromCurrency_toCurrency).toEqual({
      rateDate: rateDateToUtc('2026-09-08'),
      fromCurrency: 'USD',
      toCurrency: 'CNY',
    });
    expect(arg.create.rate).toBe(72345);
    expect(arg.create.source).toBe('OPERATOR');
    expect(arg.create.operatorId).toBe('admin-1');
    expect(arg.update.rate).toBe(72345);
    expect(view.rateDecimal).toBe(7.2345);
    expect(view.rate).toBe(72345);
    expect(view.rateDate).toBe('2026-09-08');
  });

  it('非真实日历日（2026-02-30）→ E-RATE-002（正则挡不住的 roll-over 由 round-trip 复核）', async () => {
    await expect(
      upsertRate({ rateDate: '2026-02-30', rate: 7.2, operatorId: 'admin-1' }),
    ).rejects.toMatchObject({ response: { code: 'E-RATE-002' } });
    expect(mockDb.exchangeRate.upsert).not.toHaveBeenCalled();
  });

  it('rate 区间非法（0 / 负数 / ≥10000）→ E-RATE-001', async () => {
    for (const bad of [0, -1, 10000]) {
      await expect(
        upsertRate({ rateDate: '2026-09-08', rate: bad, operatorId: 'admin-1' }),
      ).rejects.toMatchObject({ response: { code: 'E-RATE-001' } });
    }
    expect(mockDb.exchangeRate.upsert).not.toHaveBeenCalled();
  });
});

describe('getEffectiveRate（client 当日查询 + 兜底）', () => {
  it('当日有表 → OPERATOR + 万分位原值', async () => {
    mockDb.exchangeRate.findUnique.mockResolvedValue(buildRow());

    const rate = await getEffectiveRate('CNY');

    expect(mockDb.exchangeRate.findUnique).toHaveBeenCalledTimes(1);
    expect(rate).toEqual({
      rateDate: '2026-09-08',
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      rate: 72345,
      rateDecimal: 7.2345,
      source: 'OPERATOR',
    });
  });

  it('当日无表 → 兜底 7.2（万分位 72000）+ source=FALLBACK', async () => {
    mockDb.exchangeRate.findUnique.mockResolvedValue(null);

    const rate = await getEffectiveRate('CNY');

    expect(rate.source).toBe('FALLBACK');
    expect(rate.rate).toBe(72000);
    expect(rate.rateDecimal).toBe(EXCHANGE_FALLBACK_RATE);
  });
});

describe('下单汇率快照（createOrder 钩子拆解）', () => {
  it('快照写入：人民币通道 1000 分 × 72345 → 7235 分（$10.00 ≈ ¥72.35）', async () => {
    const effective = await (async () => {
      mockDb.exchangeRate.findUnique.mockResolvedValue(buildRow());
      return getEffectiveRate('CNY');
    })();

    const fields = buildOrderRateFields(1000, effective);

    expect(fields).toEqual({ exchangeRate: 72345, estimatedCnyAmount: 7235 });
  });

  it('非人民币单不写快照：COD → resolveOrderEffectiveRate 返回 null 且不查库；fields 双 null', async () => {
    const effective = await resolveOrderEffectiveRate('COD');

    expect(effective).toBeNull();
    expect(mockDb.exchangeRate.findUnique).not.toHaveBeenCalled();
    expect(buildOrderRateFields(1000, null)).toEqual({
      exchangeRate: null,
      estimatedCnyAmount: null,
    });
  });

  it('BANK_TRANSFER/PAYPAL/STRIPE 同样不触发查库', async () => {
    for (const method of ['BANK_TRANSFER', 'PAYPAL', 'STRIPE']) {
      await expect(resolveOrderEffectiveRate(method)).resolves.toBeNull();
    }
    expect(mockDb.exchangeRate.findUnique).not.toHaveBeenCalled();
  });

  it('WECHAT + 批B 待补位枚举（WECHAT_GLOBAL/ALIPAY_CN）按字符串集合命中并取当日汇率', async () => {
    mockDb.exchangeRate.findUnique.mockResolvedValue(null); // 走兜底

    for (const method of ['WECHAT', 'WECHAT_GLOBAL', 'ALIPAY_CN']) {
      await expect(resolveOrderEffectiveRate(method)).resolves.toMatchObject({
        rate: 72000,
        source: 'FALLBACK',
      });
    }
    expect(isCnyPaymentMethod('WECHAT_GLOBAL')).toBe(true);
    expect(mockDb.exchangeRate.findUnique).toHaveBeenCalledTimes(3);
  });
});

describe('精度（万分位换算）', () => {
  it('toRateInt 吸收浮点误差（7.2345×10000 = 72344.999… → 72345）', () => {
    expect(toRateInt(7.2345)).toBe(72345);
    expect(toRateInt(7.2)).toBe(72000);
    expect(toRateInt(EXCHANGE_FALLBACK_RATE)).toBe(72000);
  });

  it('fromRateInt 往返还原', () => {
    expect(fromRateInt(72345)).toBe(7.2345);
    expect(fromRateInt(toRateInt(7.2345))).toBe(7.2345);
  });

  it('calcCnyAmount 四舍五入（999×72345/10000 = 7227.2655 → 7227；7234.5 → 7235；101 → 7307）', () => {
    expect(calcCnyAmount(999, 72345)).toBe(7227);
    expect(calcCnyAmount(1000, 72345)).toBe(7235);
    expect(calcCnyAmount(101, 72345)).toBe(731); // 730.6845 → 731（进位路径，$1.01 ≈ ¥7.31）
    expect(calcCnyAmount(0, 72345)).toBe(0);
  });
});

describe('listRates（admin 历史，游标分页）', () => {
  it('take limit+1 探测 hasMore，nextCursor = 本页最后一条 rateDate', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      buildRow({ id: `rate-${i}`, rateDate: rateDateToUtc(`2026-09-0${8 - i}`) }),
    );
    mockDb.exchangeRate.findMany.mockResolvedValue(rows);

    const result = await listRates({ limit: 2 });

    expect(mockDb.exchangeRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('2026-09-07');
  });

  it('不足一页 → nextCursor=null；cursor 透传为 rateDate lt 过滤', async () => {
    mockDb.exchangeRate.findMany.mockResolvedValue([buildRow()]);

    const result = await listRates({ cursor: '2026-09-01', limit: 20 });

    expect(result.nextCursor).toBeNull();
    const arg = mockDb.exchangeRate.findMany.mock.calls[0][0];
    expect(arg.where.rateDate.lt).toEqual(rateDateToUtc('2026-09-01'));
  });
});

describe('契约 schema safeParse（controller zod 盲区按规约直测 schema）', () => {
  it('UpsertExchangeRateRequest：合法通过；rate≤0 / 日期格式错拒绝', () => {
    expect(UpsertExchangeRateRequest.safeParse({ rateDate: '2026-09-08', rate: 7.2345 }).success).toBe(true);
    expect(UpsertExchangeRateRequest.safeParse({ rateDate: '2026-09-08', rate: 0 }).success).toBe(false);
    expect(UpsertExchangeRateRequest.safeParse({ rateDate: '2026-09-08', rate: -7.2 }).success).toBe(false);
    expect(UpsertExchangeRateRequest.safeParse({ rateDate: '2026-9-8', rate: 7.2 }).success).toBe(false);
  });

  it('UpsertExchangeRateRequest：rate=10000 开区间边界拒绝（P3-3 契约与 service >=10000 对齐），9999.9 放行', () => {
    expect(UpsertExchangeRateRequest.safeParse({ rateDate: '2026-09-08', rate: 10000 }).success).toBe(false);
    expect(UpsertExchangeRateRequest.safeParse({ rateDate: '2026-09-08', rate: 9999.9 }).success).toBe(true);
  });

  it('ListExchangeRatesQuery：非法日历日（02-30）由 service round-trip 复核 → E-RATE-002（zod 正则只挡格式）', async () => {
    // P3-1：契约层只挡格式（正则通过），service listRates 复核真实日历日
    expect(ListExchangeRatesQuery.safeParse({ startDate: '2026-02-30' }).success).toBe(true);
    await expect(listRates({ startDate: '2026-02-30' })).rejects.toMatchObject({
      response: { code: 'E-RATE-002' },
    });
    await expect(listRates({ endDate: '2026-02-30' })).rejects.toMatchObject({
      response: { code: 'E-RATE-002' },
    });
    await expect(listRates({ cursor: '2026-02-30' })).rejects.toMatchObject({
      response: { code: 'E-RATE-002' },
    });
    expect(mockDb.exchangeRate.findMany).not.toHaveBeenCalled();
  });

  it('ClientExchangeRateQuery：缺省默认 CNY；非法币种拒绝', () => {
    expect(ClientExchangeRateQuery.safeParse({}).success).toBe(true);
    expect(ClientExchangeRateQuery.safeParse({}).data?.to).toBe('CNY');
    expect(ClientExchangeRateQuery.safeParse({ to: 'JPY' }).success).toBe(false);
  });

  it('ListExchangeRatesQuery：limit coerce + 夹在 1-100', () => {
    expect(ListExchangeRatesQuery.safeParse({ limit: '50' }).data?.limit).toBe(50);
    expect(ListExchangeRatesQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListExchangeRatesQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
});
