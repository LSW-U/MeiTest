/**
 * 缺货看板 tab - statistics 页（缺货履约闭环批4 2026-10-24 · A5）
 *
 * 后端：GET /admin/statistics/out-of-stock（只读聚合，OosBoardService 独立轻 service——
 *       不动 RealOrderAggregator/Settlement/statistics 既有口径）
 *
 * 展示：三指标卡片（登记率/自动退款率/人工介入率，率 null = 分母 0 无意义）+
 *       按日趋势折线（recharts 复用页内既有图表惯例）
 * 时间范围：页头公共选择器传入（预设三值 或 自定义 from/to）
 */
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { PackageX, Zap, UserCog } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOosBoard } from '@/hooks/api/use-statistics';

export interface OosBoardTabProps {
  /** 预设范围（自定义时为 undefined） */
  range?: 'today' | 'week' | 'month';
  /** 自定义范围（预设时为 undefined），YYYY-MM-DD 含头尾 */
  custom?: { from: string; to: string };
}

export function OosBoardTab({ range, custom }: OosBoardTabProps) {
  const t = useTranslations('common');
  const format = useFormatter();

  const { data, isPending, error, refetch } = useOosBoard({ range, custom });

  if (error) return <ErrorState onRetry={() => refetch()} />;
  if (isPending) return <Skeleton className="h-72 w-full" />;

  /** 率格式化：null（分母 0）→ noGrowth 文案；否则百分比一位小数（批D rate 同款） */
  function formatRate(rate: number | null | undefined): string {
    if (rate === null || rate === undefined) return t('admin.statistics.noGrowth');
    return `${(rate * 100).toFixed(1)}%`;
  }

  const trend = data?.trend ?? [];

  return (
    <div className="space-y-4">
      {/* 三指标卡片：登记率 / 自动退款率 / 人工介入率（批4 A5） */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.oosReportRate')}
            </CardTitle>
            <PackageX className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatRate(data?.reportRate)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.oosReportRateDenominator', {
                reported: format.number(data?.reportedOrderCount ?? 0),
                fulfilled: format.number(data?.fulfilledOrderCount ?? 0),
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.oosAutoRefundRate')}
            </CardTitle>
            <Zap className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatRate(data?.autoRefundRate)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.oosAutoRefundRateDenominator', {
                system: format.number(data?.systemRefundCount ?? 0),
                total: format.number(data?.oosRefundCount ?? 0),
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('admin.statistics.oosManualRate')}
            </CardTitle>
            <UserCog className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatRate(data?.manualInterventionRate)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.statistics.oosManualRateDenominator', {
                pending: format.number(data?.pendingCount ?? 0),
                total: format.number(data?.oosRefundCount ?? 0),
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 按日趋势（Dili 当地日切桶）：登记数 / OOS 退款单 / system 直退单 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.statistics.oosTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('admin.statistics.noTrendData')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  formatter={(value) =>
                    t(
                      `admin.statistics.oosTrend${value === 'reported' ? 'Reported' : value === 'oosRefunds' ? 'OosRefunds' : 'SystemRefunds'}` as 'admin.statistics.oosTrendReported',
                    )
                  }
                />
                <Line
                  type="monotone"
                  dataKey="reported"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="oosRefunds"
                  stroke="hsl(var(--secondary-foreground))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="systemRefunds"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
