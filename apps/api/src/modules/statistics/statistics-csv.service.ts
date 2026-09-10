/**
 * Statistics CSV Service（报表导出组装）
 *
 * 来源：数据分析报表模块 批B（2026-09-10）——商品排行 CSV 导出（B4 验收依赖）
 *       数据分析报表模块 批C（2026-09-10）——骑手绩效 CSV 导出
 *
 * 转义对齐 exportStocksCsv 先例（inventory.service.ts:509-517）：
 *   - CSV injection 防护：= + - @ 开头前缀单引号（Excel/WPS 当文本，防公式执行）
 *   - 标准字段转义：含引号/逗号/换行 → 引号包裹 + 引号双写
 * 列名走 shared-locales 对应语（lang query 显式传，admin-web locale 在 cookie）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { messages, DEFAULT_LOCALE, type Locale } from '@meimart/shared-locales';
import type { SupportedLanguage } from '@meimart/shared-utils';

/** 商品排行导出列 key（与 admin-web「商品排行」表格列一一对应，列名 i18n key 在 admin.statistics.export* ） */
const EXPORT_COLUMNS = [
  'rank',
  'productName',
  'orderCount',
  'quantitySold',
  'gmvAmountUsdCents',
] as const;

/** 骑手绩效导出列 key（与 admin-web「骑手绩效」表格列一一对应，列名 i18n key 在 admin.statistics.export* ） */
const RIDER_EXPORT_COLUMNS = [
  'rank',
  'riderName',
  'completedOrders',
  'incomeUsdCents',
  'rating',
  'abnormalOrders',
] as const;

/** 退款统计导出列 key（批D；与 admin-web「退款统计」汇总卡+原因分布对应，列名 i18n key 在 admin.statistics.export* ） */
const REFUND_EXPORT_COLUMNS = [
  'reason',
  'refundCount',
  'refundAmountUsdCents',
] as const;

/** 客户分析导出行结构（批E；指标汇总型 → 键值两列式：metricLabel / value） */
interface CustomerMetricRow {
  key: 'newCustomers' | 'repeatCustomers' | 'repeatRate' | 'avgOrderValueUsdCents' | 'gmvOrderCount' | 'orderUserCount';
  value: (d: { newCustomers: number; repeatCustomers: number; repeatRate: number | null; avgOrderValue: number | null; gmvOrderCount: number; orderUserCount: number }) => string;
}
const CUSTOMER_EXPORT_ROWS: CustomerMetricRow[] = [
  { key: 'newCustomers', value: (d) => String(d.newCustomers) },
  { key: 'repeatCustomers', value: (d) => String(d.repeatCustomers) },
  { key: 'repeatRate', value: (d) => (d.repeatRate === null ? '' : (d.repeatRate * 100).toFixed(1) + '%') },
  { key: 'avgOrderValueUsdCents', value: (d) => (d.avgOrderValue === null ? '' : String(Math.round(d.avgOrderValue))) },
  { key: 'gmvOrderCount', value: (d) => String(d.gmvOrderCount) },
  { key: 'orderUserCount', value: (d) => String(d.orderUserCount) },
];

@Injectable()
export class StatisticsCsvService {
  constructor(@Inject(StatisticsService) private readonly statistics: StatisticsService) {}

  /**
   * 商品排行导出 CSV
   *
   * @param lang  导出语言（query 显式传；列名 + 商品名切片都用它，商品名缺语 fallback en）
   */
  async exportTopProductsCsv(params: {
    range?: 'today' | 'week' | 'month';
    from?: string;
    to?: string;
    lang: SupportedLanguage;
  }): Promise<string> {
    const { items } = await this.statistics.getTopProductsForExport(params);

    // 列名：shared-locales common.json admin.statistics.export 块（五语 parity）
    // lang query 显式传（admin-web locale 在 cookie，不走 Accept-Language）；未知语兜底 en
    const locale = (params.lang as Locale) ?? DEFAULT_LOCALE;
    const bundle = messages[locale] ?? messages[DEFAULT_LOCALE];
    const stat = (bundle.common as Record<string, unknown>)['admin'] as Record<
      string,
      unknown
    >;
    const block = (stat['statistics'] ?? {}) as Record<string, string>;

    // CSV escape（对齐 inventory.service.ts:509-517 先例）
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      // CSV injection 防护：= + - @ 开头前缀单引号（Excel/WPS 当文本，防公式执行）
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      // 标准字段转义（引号/逗号/换行）
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = EXPORT_COLUMNS.map((c) => escape(block[`export${c.charAt(0).toUpperCase()}${c.slice(1)}`] ?? c)).join(',');
    const rows = items.map((item, idx) =>
      [
        escape(idx + 1),
        escape(item.productName),
        escape(item.orderCount),
        escape(item.quantitySold),
        escape(item.gmvAmount),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /**
   * 骑手绩效导出 CSV（批C）
   *
   * @param lang  导出语言（query 显式传；只影响列名——riderName 单值字符串无切片）
   */
  async exportRidersCsv(params: {
    range?: 'today' | 'week' | 'month';
    from?: string;
    to?: string;
    lang: SupportedLanguage;
  }): Promise<string> {
    const { items } = await this.statistics.getRidersForExport(params);

    // 列名：shared-locales common.json admin.statistics.export 块（五语 parity）——
    // 列名解析逻辑与 exportTopProductsCsv 相同（列名走同层 export* key）
    const locale = (params.lang as Locale) ?? DEFAULT_LOCALE;
    const bundle = messages[locale] ?? messages[DEFAULT_LOCALE];
    const stat = (bundle.common as Record<string, unknown>)['admin'] as Record<
      string,
      unknown
    >;
    const block = (stat['statistics'] ?? {}) as Record<string, string>;

    // CSV escape（对齐 inventory.service.ts:509-517 先例，与 exportTopProductsCsv 逐字节同法）
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      // CSV injection 防护：= + - @ 开头前缀单引号（Excel/WPS 当文本，防公式执行）
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      // 标准字段转义（引号/逗号/换行）
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = RIDER_EXPORT_COLUMNS.map(
      (c) => escape(block[`export${c.charAt(0).toUpperCase()}${c.slice(1)}`] ?? c),
    ).join(',');
    const rows = items.map((item, idx) =>
      [
        escape(idx + 1),
        escape(item.riderName),
        escape(item.completedOrders),
        escape(item.income),
        escape(item.rating.toFixed(2)),
        escape(item.abnormalCount),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  /**
   * 退款统计导出 CSV（批D）
   *
   * 行结构 = 原因分布表（每原因一行），首列 reason 展示**枚举原文**（OUT_OF_STOCK 等，
   * 约定外值归 OTHER——不做文案映射，任务书 §2 改动 3 拍板）；末行附总计（汇总卡三值）。
   * lang 只影响列名。
   */
  async exportRefundsCsv(params: {
    range?: 'today' | 'week' | 'month';
    from?: string;
    to?: string;
    lang: SupportedLanguage;
  }): Promise<string> {
    const data = await this.statistics.getRefundsForExport(params);

    const locale = (params.lang as Locale) ?? DEFAULT_LOCALE;
    const bundle = messages[locale] ?? messages[DEFAULT_LOCALE];
    const stat = (bundle.common as Record<string, unknown>)['admin'] as Record<
      string,
      unknown
    >;
    const block = (stat['statistics'] ?? {}) as Record<string, string>;

    // CSV escape（对齐 inventory.service.ts:509-517 先例，与前两个导出方法逐字节同法）
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      // CSV injection 防护：= + - @ 开头前缀单引号（Excel/WPS 当文本，防公式执行）
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      // 标准字段转义（引号/逗号/换行）
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = REFUND_EXPORT_COLUMNS.map(
      (c) => escape(block[`export${c.charAt(0).toUpperCase()}${c.slice(1)}`] ?? c),
    ).join(',');
    const rows = data.reasonBreakdown.map((it) =>
      [escape(it.reason), escape(it.count), escape(it.amount)].join(','),
    );
    // 末行总计：首列放「总计」列名位（exportRefundTotal），后两列 = 汇总卡单量/金额
    const totalRow = [
      escape(block['exportRefundTotal'] ?? 'Total'),
      escape(data.refundCount),
      escape(data.refundAmount),
    ].join(',');
    return [header, ...rows, totalRow].join('\n');
  }

  /**
   * 客户分析导出 CSV（批E）
   *
   * 指标汇总型（无行维度）→ 键值两列式：每指标一行（指标名按 lang 列名 + 值），
   * 符合任务书 §2 改动 3"实现取简，审查对齐'列=表格列'精神即可"。
   * repeatRate 百分比一位小数；avgOrderValue 保留分（Math.round 防 AOV 带小数）；
   * nullable（分母 0）→ 空串。lang 只影响指标名。
   */
  async exportCustomersCsv(params: {
    range?: 'today' | 'week' | 'month';
    from?: string;
    to?: string;
    lang: SupportedLanguage;
  }): Promise<string> {
    const data = await this.statistics.getCustomersForExport(params);

    const locale = (params.lang as Locale) ?? DEFAULT_LOCALE;
    const bundle = messages[locale] ?? messages[DEFAULT_LOCALE];
    const stat = (bundle.common as Record<string, unknown>)['admin'] as Record<
      string,
      unknown
    >;
    const block = (stat['statistics'] ?? {}) as Record<string, string>;

    // CSV escape（对齐 inventory.service.ts:509-517 先例，与前三导出方法逐字节同法）
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      // CSV injection 防护：= + - @ 开头前缀单引号（Excel/WPS 当文本，防公式执行）
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      // 标准字段转义（引号/逗号/换行）
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = [
      escape(block['exportMetric'] ?? 'Metric'),
      escape(block['exportValue'] ?? 'Value'),
    ].join(',');
    const rows = CUSTOMER_EXPORT_ROWS.map((r) => {
      const i18nKey = `export${r.key.charAt(0).toUpperCase()}${r.key.slice(1)}`;
      return [escape(block[i18nKey] ?? r.key), escape(r.value(data))].join(',');
    });
    return [header, ...rows].join('\n');
  }
}
