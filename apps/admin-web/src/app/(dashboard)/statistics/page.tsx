/**
 * 统计报表页 - /statistics
 *
 * W7-ext-E 实现（2026-07-10）
 * 后端：GET /admin/platform/dashboard/summary?range=today|week|month
 *   - 4 KPI：GMV / 订单数 / 在线骑手 / 异常订单
 *   - 趋势图：gmv + orderCount 双轴折线
 *   - 仓库分布：条形图
 */
'use client';

import { useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Users, AlertTriangle, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useDashboardSummary, type DashboardRange } from '@/hooks/api/use-dashboard';
import { formatCurrency } from '@/lib/utils';

const RANGES: DashboardRange[] = ['today', 'week', 'month'];

export default function StatisticsPage() {
  const t = useTranslations('common');
  const format = useFormatter();
  const [range, setRange] = useState<DashboardRange>('today');

  const { data, isPending, error, refetch } = useDashboardSummary(range);

  const isLoading = isPending;

  function formatGrowth(pct: number | null): { label: string; isUp: boolean } {
    if (pct === null || isNaN(pct)) return { label: t('admin.statistics.noGrowth'), isUp: false };
    const isUp = pct >= 0;
    const sign = isUp ? '+' : '';
    return { label: `${sign}${pct.toFixed(1)}%`, isUp };
  }

  const gmvGrowth = data ? formatGrowth(data.gmvGrowthPct) : null;
  const orderGrowth = data ? formatGrowth(data.orderCountGrowthPct) : null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.statistics.title')} description={t('admin.statistics.description')} />

      <Tabs value={range} onValueChange={(v) => setRange(v as DashboardRange)}>
        <TabsList>
          {RANGES.map((r) => (
            <TabsTrigger key={r} value={r}>
              {t(`admin.statistics.range${r.charAt(0).toUpperCase() + r.slice(1)}` as 'admin.statistics.rangeToday')}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : !data ? (
        <EmptyState title={t('admin.statistics.empty')} description={t('admin.statistics.emptyDescription')} />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<TrendingUp className="h-5 w-5" />}
              label={t('admin.statistics.gmv')}
              value={formatCurrency(data.gmv)}
              growth={gmvGrowth ?? undefined}
            />
            <KpiCard
              icon={<ShoppingCart className="h-5 w-5" />}
              label={t('admin.statistics.orderCount')}
              value={format.number(data.orderCount)}
              growth={orderGrowth ?? undefined}
            />
            <KpiCard
              icon={<Users className="h-5 w-5" />}
              label={t('admin.statistics.onlineRiders')}
              value={format.number(data.onlineRiderCount)}
            />
            <KpiCard
              icon={<AlertTriangle className="h-5 w-5" />}
              label={t('admin.statistics.abnormalOrders')}
              value={format.number(data.abnormalOrderCount)}
              variant={data.abnormalOrderCount > 0 ? 'warning' : 'default'}
            />
          </div>

          {/* 趋势图 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.statistics.trend')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.trend.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t('admin.statistics.noTrendData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.trend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
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
                      formatter={(value, name) => {
                        const v = Number(value);
                        if (name === 'gmv') return [formatCurrency(v), t('admin.statistics.gmv')];
                        return [format.number(v), t('admin.statistics.orderCount')];
                      }}
                    />
                    <Legend formatter={(value) => t(`admin.statistics.${value}` as 'admin.statistics.gmv')} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="gmv"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="orderCount"
                      stroke="hsl(var(--chart-2))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* 仓库分布 */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.statistics.warehouseBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.warehouseBreakdown.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t('admin.statistics.noWarehouseData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={data.warehouseBreakdown}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="warehouseName"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                    />
                    <YAxis
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
                      formatter={(value, name) => {
                        const v = Number(value);
                        if (name === 'gmv') return [formatCurrency(v), t('admin.statistics.gmv')];
                        if (name === 'orderCount') return [format.number(v), t('admin.statistics.orderCount')];
                        return [format.number(v), t('admin.statistics.abnormalOrders')];
                      }}
                    />
                    <Legend
                      formatter={(value) =>
                        t(`admin.statistics.${value === 'gmv' ? 'gmv' : value === 'orderCount' ? 'orderCount' : 'abnormalOrders'}` as 'admin.statistics.gmv')
                      }
                    />
                    <Bar dataKey="gmv" fill="hsl(var(--primary))" />
                    <Bar dataKey="orderCount" fill="hsl(var(--chart-2))" />
                    <Bar dataKey="abnormalCount" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  growth,
  variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  growth?: { label: string; isUp: boolean };
  variant?: 'default' | 'warning';
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className={variant === 'warning' ? 'text-destructive' : 'text-muted-foreground'}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {growth && (
          <Badge variant="outline" className={`mt-2 ${growth.isUp ? 'text-green-600' : 'text-red-600'}`}>
            {growth.isUp ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
            {growth.label}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
