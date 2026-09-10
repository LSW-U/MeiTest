/**
 * 客户分析 tab - statistics 页（数据分析报表模块 批E，2026-09-10）
 *
 * 后端：GET /admin/statistics/customers（R4 MVP 三指标：新客=全局首单在区间内；
 *       复购=区间 ≥2 单；AOV=GMV/订单数——非 ARPU；金额单位分）
 *       GET /admin/statistics/customers/export?...&lang=（CSV 键值两列式，lang 显式传）
 *
 * 展示：汇总卡 ×3（新客数/复购率/客单价）+ 双分母口径注脚（复购率分母=下单用户数、
 *       AOV 分母=订单数）；时间范围：页头公共选择器传入（预设三值 或 自定义 from/to）
 */
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCustomers } from '@/hooks/api/use-statistics';
import { API_BASE_URL } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export interface CustomersTabProps {
  /** 预设范围（自定义时为 undefined） */
  range?: 'today' | 'week' | 'month';
  /** 自定义范围（预设时为 undefined），YYYY-MM-DD 含头尾 */
  custom?: { from: string; to: string };
}

export function CustomersTab({ range, custom }: CustomersTabProps) {
  const t = useTranslations('common');
  const format = useFormatter();

  const { data, isPending, error, refetch } = useCustomers({ range, custom });

  function handleExport() {
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (custom) {
      params.set('from', custom.from);
      params.set('to', custom.to);
    }
    // lang 定死 query 显式传（locale 在 documentElement.lang，cookie 不随请求走）
    params.set('lang', document.documentElement.lang || 'en');
    // 与 apiFetch 同源拼绝对地址（同 refunds-tab 先例：相对路径会打到 :3001 页面路由 404）
    window.open(`${API_BASE_URL}/admin/statistics/customers/export?${params.toString()}`, '_blank');
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

      {/* 汇总卡 ×3：新客数 / 复购率 / 客单价（null = 分母 0，区间内无 GMV 状态订单） */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.newCustomers')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{format.number(data?.newCustomers ?? 0)}</div>
            {/* 口径注脚：新客 = 全局首单落在区间内（非"区间内有单"） */}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.newCustomersHint')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.repeatRate')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.repeatRate === null || data?.repeatRate === undefined
                ? t('admin.statistics.noGrowth')
                : `${(data.repeatRate * 100).toFixed(1)}%`}
            </div>
            {/* 口径注脚：复购 = 区间内 ≥2 单；分母 = 区间内下单用户数 */}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.repeatRateDenominator', {
                count: format.number(data?.orderUserCount ?? 0),
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.avgOrderValue')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.avgOrderValue === null || data?.avgOrderValue === undefined
                ? t('admin.statistics.noGrowth')
                : formatCurrency(Math.round(data.avgOrderValue))}
            </div>
            {/* 口径注脚：AOV = 区间 GMV / 区间订单数（非 ARPU） */}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.aovDenominator', {
                count: format.number(data?.gmvOrderCount ?? 0),
              })}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
