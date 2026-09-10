/**
 * 退款统计 tab - statistics 页（数据分析报表模块 批D，2026-09-10）
 *
 * 后端：GET /admin/statistics/refunds（口径=数据口径.md §2：计入口径 status ∈
 *       APPROVED/COMPLETED；rate 分母=同期 GMV 状态订单数；金额单位分）
 *       GET /admin/statistics/refunds/export?...&lang=（CSV，lang 显式传——locale 在 cookie）
 *
 * 展示：汇总卡 ×3（退款单量/退款金额/退款率）+ 原因分布表（reason 枚举原文，
 *       约定外值后端已归 OTHER；不做文案映射，任务书 §2 改动 3 拍板）
 * 时间范围：页头公共选择器传入（预设三值 或 自定义 from/to）
 */
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRefunds } from '@/hooks/api/use-statistics';
import { API_BASE_URL } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export interface RefundsTabProps {
  /** 预设范围（自定义时为 undefined） */
  range?: 'today' | 'week' | 'month';
  /** 自定义范围（预设时为 undefined），YYYY-MM-DD 含头尾 */
  custom?: { from: string; to: string };
}

export function RefundsTab({ range, custom }: RefundsTabProps) {
  const t = useTranslations('common');
  const format = useFormatter();

  const { data, isPending, error, refetch } = useRefunds({ range, custom });
  const breakdown = data?.reasonBreakdown ?? [];

  function handleExport() {
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (custom) {
      params.set('from', custom.from);
      params.set('to', custom.to);
    }
    // lang 定死 query 显式传（locale 在 documentElement.lang，cookie 不随请求走）
    params.set('lang', document.documentElement.lang || 'en');
    // 与 apiFetch 同源拼绝对地址（同 riders-tab 先例：相对路径会打到 :3001 页面路由 404）
    window.open(`${API_BASE_URL}/admin/statistics/refunds/export?${params.toString()}`, '_blank');
  }

  if (error) return <ErrorState onRetry={() => refetch()} />;
  if (isPending) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          {t('admin.statistics.exportCsv')}
        </Button>
      </div>

      {/* 汇总卡 ×3：退款单量 / 退款金额 / 退款率（rate null = 同期无 GMV 状态订单） */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.refundCount')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{format.number(data?.refundCount ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.refundAmount')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data?.refundAmount ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.refundRate')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.rate === null || data?.rate === undefined
                ? t('admin.statistics.noGrowth')
                : `${(data.rate * 100).toFixed(1)}%`}
            </div>
            {/* 口径注脚：分母 = 同期 GMV 状态订单数（数据口径.md §2） */}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.refundRateDenominator', { count: format.number(data?.gmvOrderCount ?? 0) })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 原因分布表（reason 枚举原文，约定外值后端归 OTHER） */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.statistics.reasonBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent>
          {breakdown.length === 0 ? (
            <EmptyState
              title={t('admin.statistics.empty')}
              description={t('admin.statistics.noRefunds')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t('admin.statistics.refundReason')}</th>
                    <th className="pb-2 pr-4 text-right font-medium">
                      {t('admin.statistics.refundCount')}
                    </th>
                    <th className="pb-2 text-right font-medium">
                      {t('admin.statistics.refundAmount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((it) => (
                    <tr key={it.reason} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{it.reason}</td>
                      <td className="py-2 pr-4 text-right">{format.number(it.count)}</td>
                      <td className="py-2 text-right">{formatCurrency(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
