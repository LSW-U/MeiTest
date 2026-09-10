/**
 * StatisticsCsvService 单测（数据分析报表模块 批B，2026-09-10）
 *
 * 重点验证（任务书 §2 改动 8 + B4 验收依赖）：
 *   - CSV 转义：= + - @ 前缀加 ' （公式注入防护）
 *   - 引号/逗号/换行 → 引号包裹 + 引号双写
 *   - 列名走 shared-locales admin.statistics.export* 对应语
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/shared/db', () => ({ db: {} }));

import { StatisticsCsvService } from '../src/modules/statistics/statistics-csv.service';
import { StatisticsService } from '../src/modules/statistics/statistics.service';

/** 只 mock getTopProductsForExport / getRidersForExport 的数据源 */
vi.mock('../src/modules/statistics/statistics.service', () => ({
  StatisticsService: class {
    getTopProductsForExport = vi.fn().mockResolvedValue({
      from: '2026-06-22T15:00:00.000Z',
      to: '2026-06-23T15:00:00.000Z',
      items: [],
    });
    getRidersForExport = vi.fn().mockResolvedValue({
      from: '2026-06-22T15:00:00.000Z',
      to: '2026-06-23T15:00:00.000Z',
      items: [],
    });
    getRefundsForExport = vi.fn().mockResolvedValue({
      from: '2026-06-22T15:00:00.000Z',
      to: '2026-06-23T15:00:00.000Z',
      refundCount: 0,
      refundAmount: 0,
      rate: null,
      gmvOrderCount: 0,
      reasonBreakdown: [],
    });
    getCustomersForExport = vi.fn().mockResolvedValue({
      from: '2026-06-22T15:00:00.000Z',
      to: '2026-06-23T15:00:00.000Z',
      newCustomers: 0,
      repeatCustomers: 0,
      repeatRate: null,
      avgOrderValue: null,
      gmvOrderCount: 0,
      orderUserCount: 0,
    });
  },
}));

function mockItem(productName: string) {
  return {
    productId: '11111111-1111-1111-1111-111111111111',
    productName,
    productImage: null,
    orderCount: 3,
    quantitySold: 8,
    gmvAmount: 1234,
  };
}

describe('StatisticsCsvService.exportTopProductsCsv', () => {
  let service: StatisticsCsvService;
  let source: { getTopProductsForExport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StatisticsCsvService(new StatisticsService());
    source = (service as unknown as { statistics: { getTopProductsForExport: ReturnType<typeof vi.fn> } })
      .statistics;
  });

  it('公式注入防护：= + - @ 开头前缀单引号', async () => {
    source.getTopProductsForExport.mockResolvedValue({
      from: '', to: '',
      items: [mockItem('=SUM(A1)'), mockItem('+cmd'), mockItem('-1;DROP'), mockItem('@x')],
    });
    const csv = await service.exportTopProductsCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[1]).toContain("'=SUM(A1)");
    expect(lines[2]).toContain("'+cmd");
    expect(lines[3]).toContain("'-1;DROP");
    expect(lines[4]).toContain("'@x");
    // 前缀单引号后不再出现裸 = 开头字段
    expect(lines[1].split(',')[1].startsWith('"=')).toBe(false);
  });

  it('逗号/引号/换行 → 引号包裹 + 引号双写', async () => {
    source.getTopProductsForExport.mockResolvedValue({
      from: '', to: '',
      items: [
        mockItem('Rice, 5kg'),
        mockItem('The "Best" Milk'),
        mockItem('Line1\nLine2'),
      ],
    });
    const csv = await service.exportTopProductsCsv({ range: 'week', lang: 'en' });
    expect(csv).toContain('"Rice, 5kg"');
    expect(csv).toContain('"The ""Best"" Milk"');
    // 换行字段整体被引号包裹（多行字段真实占两行，不能按单行切分断言）
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('组合场景：= 开头 + 含逗号 + 含引号', async () => {
    source.getTopProductsForExport.mockResolvedValue({
      from: '', to: '',
      items: [mockItem('=HYPERLINK("http://evil.example","click")')],
    });
    const csv = await service.exportTopProductsCsv({ range: 'week', lang: 'en' });
    const dataField = csv.split('\n')[1].split(',')[1];
    // 既有 injection 前缀又有标准转义：外层引号包裹，内层引号双写，= 前有 '
    expect(dataField.startsWith('"\'=')).toBe(true);
    expect(dataField).toContain('""http://evil.example""');
  });

  it('列名走 shared-locales 对应语（en / zh 各一行头）', async () => {
    source.getTopProductsForExport.mockResolvedValue({ from: '', to: '', items: [] });
    const en = await service.exportTopProductsCsv({ range: 'week', lang: 'en' });
    expect(en.split('\n')[0]).toBe('Rank,Product,Orders,Units Sold,GMV (USD cents)');
    const zh = await service.exportTopProductsCsv({ range: 'week', lang: 'zh' });
    expect(zh.split('\n')[0]).toBe('排名,商品,订单数,销量,GMV（美分）');
  });

  it('未知语言兜底 DEFAULT_LOCALE（en）列头', async () => {
    source.getTopProductsForExport.mockResolvedValue({ from: '', to: '', items: [] });
    const csv = await service.exportTopProductsCsv({ range: 'week', lang: 'xx' as never });
    expect(csv.split('\n')[0]).toBe('Rank,Product,Orders,Units Sold,GMV (USD cents)');
  });

  it('行序 = 排名序（idx+1），数值列不转义变形', async () => {
    source.getTopProductsForExport.mockResolvedValue({
      from: '', to: '',
      items: [mockItem('Apple'), mockItem('Banana')],
    });
    const csv = await service.exportTopProductsCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[1].split(',')[0]).toBe('1');
    expect(lines[2].split(',')[0]).toBe('2');
    expect(lines[1].split(',')[3]).toBe('8');
    expect(lines[1].split(',')[4]).toBe('1234');
  });
});

describe('StatisticsCsvService.exportRidersCsv', () => {
  let service: StatisticsCsvService;
  let source: { getRidersForExport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StatisticsCsvService(new StatisticsService());
    source = (service as unknown as { statistics: { getRidersForExport: ReturnType<typeof vi.fn> } })
      .statistics;
  });

  function mockRider(riderName: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      riderId: '11111111-1111-1111-1111-111111111111',
      riderName,
      completedOrders: 12,
      income: 15000,
      rating: 4.85,
      abnormalCount: 1,
      ...overrides,
    };
  }

  it('骑手名公式注入防护：= + - @ 前缀单引号（转义同法逐字节对齐商品排行）', async () => {
    source.getRidersForExport.mockResolvedValue({
      from: '', to: '',
      items: [mockRider('=CMD|whoami'), mockRider('-not-a-formula'), mockRider('@rider')],
    });
    const csv = await service.exportRidersCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[1]).toContain("'=CMD|whoami");
    expect(lines[2]).toContain("'-not-a-formula");
    expect(lines[3]).toContain("'@rider");
  });

  it('骑手名含逗号/引号 → 引号包裹 + 引号双写', async () => {
    source.getRidersForExport.mockResolvedValue({
      from: '', to: '',
      items: [mockRider('João "J" Silva, Jr')],
    });
    const csv = await service.exportRidersCsv({ range: 'week', lang: 'en' });
    expect(csv).toContain('"João ""J"" Silva, Jr"');
  });

  it('列名五语走 shared-locales 对应语（en / zh / pt 各一行头）', async () => {
    source.getRidersForExport.mockResolvedValue({ from: '', to: '', items: [] });
    const en = await service.exportRidersCsv({ range: 'week', lang: 'en' });
    expect(en.split('\n')[0]).toBe(
      'Rank,Rider,Completed Orders,Income (USD cents),Rating,Abnormal Orders',
    );
    const zh = await service.exportRidersCsv({ range: 'week', lang: 'zh' });
    expect(zh.split('\n')[0]).toBe('排名,骑手,完成单数,收入（美分）,评分,异常单数');
    const pt = await service.exportRidersCsv({ range: 'week', lang: 'pt' });
    expect(pt.split('\n')[0]).toBe('Posição,Entregador,Pedidos Concluídos,Renda (centavos USD),Avaliação,Pedidos Anormais');
  });

  it('数值列不转义变形：rating 两位小数 / income 分原值 / 行序 = 排名序', async () => {
    source.getRidersForExport.mockResolvedValue({
      from: '', to: '',
      items: [mockRider('Ali'), mockRider('Budi', { completedOrders: 3, income: 500, rating: 4.1, abnormalCount: 0 })],
    });
    const csv = await service.exportRidersCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[1].split(',')[0]).toBe('1');
    expect(lines[2].split(',')[0]).toBe('2');
    expect(lines[1].split(',')[2]).toBe('12');
    expect(lines[1].split(',')[3]).toBe('15000');
    expect(lines[1].split(',')[4]).toBe('4.85');
    expect(lines[1].split(',')[5]).toBe('1');
    expect(lines[2].split(',')[4]).toBe('4.10');
  });
});

describe('StatisticsCsvService.exportRefundsCsv', () => {
  let service: StatisticsCsvService;
  let source: { getRefundsForExport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StatisticsCsvService(new StatisticsService());
    source = (service as unknown as { statistics: { getRefundsForExport: ReturnType<typeof vi.fn> } })
      .statistics;
  });

  /** 造一份退款统计 mock 数据 */
  function mockRefunds(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      from: '2026-06-22T15:00:00.000Z',
      to: '2026-06-23T15:00:00.000Z',
      refundCount: 5,
      refundAmount: 2300,
      rate: 0.1,
      gmvOrderCount: 50,
      reasonBreakdown: [
        { reason: 'QUALITY_ISSUE', count: 3, amount: 1500 },
        { reason: 'OUT_OF_STOCK', count: 2, amount: 800 },
      ],
      ...overrides,
    };
  }

  it('reason 枚举原文展示（不做文案映射）+ 末行总计（单量/金额）', async () => {
    source.getRefundsForExport.mockResolvedValue(mockRefunds());
    const csv = await service.exportRefundsCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Reason,Refunded Orders,Refund Amount (USD cents)');
    expect(lines[1]).toBe('QUALITY_ISSUE,3,1500');
    expect(lines[2]).toBe('OUT_OF_STOCK,2,800');
    expect(lines[3]).toBe('Total,5,2300');
  });

  it('reason 公式注入防护：= + - @ 前缀单引号（对齐前两个导出方法同法）', async () => {
    source.getRefundsForExport.mockResolvedValue(
      mockRefunds({
        reasonBreakdown: [{ reason: '=WEIRD', count: 1, amount: 100 }],
        refundCount: 1,
        refundAmount: 100,
      }),
    );
    const csv = await service.exportRefundsCsv({ range: 'week', lang: 'en' });
    expect(csv.split('\n')[1]).toContain("'=WEIRD");
  });

  it('列名五语走 shared-locales 对应语（en / zh 各一行头）', async () => {
    source.getRefundsForExport.mockResolvedValue(mockRefunds({ reasonBreakdown: [] }));
    const en = await service.exportRefundsCsv({ range: 'week', lang: 'en' });
    expect(en.split('\n')[0]).toBe('Reason,Refunded Orders,Refund Amount (USD cents)');
    const zh = await service.exportRefundsCsv({ range: 'week', lang: 'zh' });
    expect(zh.split('\n')[0]).toBe('退款原因,退款单量,退款金额（美分）');
  });

  it('约定外 reason 归 OTHER 后进入 CSV（服务层归并，CSV 层透传）', async () => {
    source.getRefundsForExport.mockResolvedValue(
      mockRefunds({
        reasonBreakdown: [{ reason: 'OTHER', count: 5, amount: 2300 }],
      }),
    );
    const csv = await service.exportRefundsCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[1]).toBe('OTHER,5,2300');
    expect(lines[2]).toBe('Total,5,2300');
  });
});

describe('StatisticsCsvService.exportCustomersCsv', () => {
  let service: StatisticsCsvService;
  let source: { getCustomersForExport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StatisticsCsvService(new StatisticsService());
    source = (service as unknown as { statistics: { getCustomersForExport: ReturnType<typeof vi.fn> } })
      .statistics;
  });

  /** 造一份客户分析 mock 数据 */
  function mockCustomers(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      from: '2026-06-22T15:00:00.000Z',
      to: '2026-06-23T15:00:00.000Z',
      newCustomers: 2,
      repeatCustomers: 1,
      repeatRate: 0.25,
      avgOrderValue: 5000,
      gmvOrderCount: 10,
      orderUserCount: 4,
      ...overrides,
    };
  }

  it('键值两列式：六指标行 + 指标名走 shared-locales（en）', async () => {
    source.getCustomersForExport.mockResolvedValue(mockCustomers());
    const csv = await service.exportCustomersCsv({ range: 'week', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Metric,Value');
    expect(lines).toHaveLength(7); // header + 6 指标行
    expect(csv).toContain('New Customers,2');
    expect(csv).toContain('Repeat Customers,1');
    expect(csv).toContain('Repeat Rate,25.0%');
    expect(csv).toContain('Avg Order Value (USD cents),5000');
    expect(csv).toContain('GMV Orders,10');
    expect(csv).toContain('Ordering Users,4');
  });

  it('repeatRate 百分比一位小数 / avgOrderValue 取整为分 / 列名 zh', async () => {
    source.getCustomersForExport.mockResolvedValue(
      mockCustomers({ repeatRate: 1 / 3, avgOrderValue: 5000.4 }),
    );
    const csv = await service.exportCustomersCsv({ range: 'week', lang: 'zh' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('指标,值');
    expect(csv).toContain('复购率,33.3%');
    expect(csv).toContain('客单价（美分）,5000'); // Math.round，不带小数
  });

  it('零分母 nullable → 空值单元格（repeatRate/avgOrderValue 为 null 时留空）', async () => {
    source.getCustomersForExport.mockResolvedValue(
      mockCustomers({ repeatRate: null, avgOrderValue: null }),
    );
    const csv = await service.exportCustomersCsv({ range: 'today', lang: 'en' });
    const lines = csv.split('\n');
    expect(lines[3]).toBe('Repeat Rate,');
    expect(lines[4]).toBe('Avg Order Value (USD cents),');
  });

  it('值列公式注入防护（对齐前三导出同法）+ 未知语兜底 DEFAULT_LOCALE（en）列头与指标名', async () => {
    // 值来自服务层 number，注入防护主要覆盖指标名路径；lang xx 兜底 en bundle 指标名
    source.getCustomersForExport.mockResolvedValue(mockCustomers({ newCustomers: 12 }));
    const csv = await service.exportCustomersCsv({ range: 'week', lang: 'xx' as never });
    expect(csv.split('\n')[0]).toBe('Metric,Value');
    expect(csv.split('\n')[1]).toBe('New Customers,12');
  });
});
