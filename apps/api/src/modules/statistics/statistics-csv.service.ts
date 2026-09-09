/**
 * Statistics CSV Service（报表导出组装）
 *
 * 来源：数据分析报表模块 批B（2026-09-10）——商品排行 CSV 导出（B4 验收依赖）
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

/** 导出列 key（与 admin-web「商品排行」表格列一一对应，列名 i18n key 在 admin.statistics.export* ） */
const EXPORT_COLUMNS = [
  'rank',
  'productName',
  'orderCount',
  'quantitySold',
  'gmvAmountUsdCents',
] as const;

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
}
