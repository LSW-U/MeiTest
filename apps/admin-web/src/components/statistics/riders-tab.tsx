/**
 * 骑手绩效 tab - statistics 页（数据分析报表模块 批C，2026-09-10）
 *
 * 后端：GET /admin/statistics/riders（R5 口径：DeliveryTask(taskType=delivery).riderId 归属，金额单位分）
 *       GET /admin/statistics/riders/export?...&lang=（CSV，lang 显式传——locale 在 cookie）
 *
 * 时间范围：页头公共选择器传入（预设三值 或 自定义 from/to）
 * 口径差（C2）：骑手详情页 totalDeliveries 是累计值（dispatch.service 送达 +1），本表是区间值
 */
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRiders } from '@/hooks/api/use-statistics';
import { API_BASE_URL } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export interface RidersTabProps {
  /** 预设范围（自定义时为 undefined） */
  range?: 'today' | 'week' | 'month';
  /** 自定义范围（预设时为 undefined），YYYY-MM-DD 含头尾 */
  custom?: { from: string; to: string };
}

export function RidersTab({ range, custom }: RidersTabProps) {
  const t = useTranslations('common');
  const format = useFormatter();

  const { data, isPending, error, refetch } = useRiders({ range, custom });
  const items = data?.items ?? [];

  function handleExport() {
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (custom) {
      params.set('from', custom.from);
      params.set('to', custom.to);
    }
    // lang 定死 query 显式传（locale 在 documentElement.lang，cookie 不随请求走）
    params.set('lang', document.documentElement.lang || 'en');
    // 与 apiFetch 同源拼绝对地址（同 top-products-tab 先例：相对路径会打到 :3001 页面路由 404）
    window.open(`${API_BASE_URL}/admin/statistics/riders/export?${params.toString()}`, '_blank');
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

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.statistics.ridersTab')}</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              title={t('admin.statistics.empty')}
              description={t('admin.statistics.noRiders')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t('admin.statistics.rank')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('admin.statistics.rider')}</th>
                    <th className="pb-2 pr-4 text-right font-medium">
                      {t('admin.statistics.completedOrders')}
                    </th>
                    <th className="pb-2 pr-4 text-right font-medium">
                      {t('admin.statistics.income')}
                    </th>
                    <th className="pb-2 pr-4 text-right font-medium">
                      {t('admin.statistics.rating')}
                    </th>
                    <th className="pb-2 text-right font-medium">
                      {t('admin.statistics.abnormalOrders')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.riderId} className="border-b last:border-0">
                      <td className="py-2 pr-4">{idx + 1}</td>
                      <td className="py-2 pr-4">
                        <span className="max-w-56 truncate">{it.riderName}</span>
                      </td>
                      <td className="py-2 pr-4 text-right">{format.number(it.completedOrders)}</td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(it.income)}</td>
                      <td className="py-2 pr-4 text-right">{it.rating.toFixed(2)}</td>
                      <td className="py-2 text-right">{format.number(it.abnormalCount)}</td>
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
