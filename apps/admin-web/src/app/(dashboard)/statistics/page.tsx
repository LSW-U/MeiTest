/**
 * 统计报表页 - /statistics（tab 容器）
 *
 * 数据分析报表模块 批B 改造（2026-09-10）：
 *   - 「总览」tab = 原 KPI + 趋势图 + 仓库分布三块原样迁入（W7-ext-E 内容不变）
 *   - 新增「商品排行」tab（components/statistics/top-products-tab.tsx）
 *   - 页头公共件：tab 容器 + 时间范围选择器（预设三值 + 自定义起止日期）
 *     ——时间选择器对两个 tab 同时生效（总览只消费预设三值，自定义时总览沿用当前预设回退）
 * 后端：
 *   - 总览：GET /admin/platform/dashboard/summary?range=today|week|month
 *   - 商品排行：GET /admin/statistics/products/top + /products/export
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDashboardSummary, type DashboardRange } from '@/hooks/api/use-dashboard';
import { formatCurrency } from '@/lib/utils';
import { TopProductsTab } from '@/components/statistics/top-products-tab';

const RANGES: DashboardRange[] = ['today', 'week', 'month'];

/** 自定义日期格式（YYYY-MM-DD，Dili 当地日期，含头尾——后端公共层校验） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function StatisticsPage() {
  const t = useTranslations('common');
  const format = useFormatter();

  // 报表级 tab：总览 / 商品排行（后续批次扩展：骑手绩效/退款统计/客户分析）
  const [reportTab, setReportTab] = useState<'overview' | 'topProducts'>('overview');

  // 时间范围：预设三值 + 自定义（提交后生效；isCustom 区分当前模式）
  const [range, setRange] = useState<DashboardRange>('today');
  const [isCustom, setIsCustom] = useState(false);
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');

  const { data, isPending, error, refetch } = useDashboardSummary(range);

  const isLoading = isPending;

  /** 自定义日期提交：两值齐且格式合法才切换（非法置空由浏览器 date input 保证，双保险） */
  function applyCustomRange() {
    if (DATE_RE.test(fromDraft) && DATE_RE.test(toDraft)) {
      setCustom({ from: fromDraft, to: toDraft });
      setIsCustom(true);
    }
  }

  /** 切回预设：清自定义态（草稿保留，便于来回切换） */
  function selectPreset(r: DashboardRange) {
    setRange(r);
    setIsCustom(false);
  }

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

      {/* 页头公共件：报表 tab + 时间范围选择器（预设三值 + 自定义起止） */}
      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={reportTab} onValueChange={(v) => setReportTab(v as 'overview' | 'topProducts')}>
          <TabsList>
            <TabsTrigger value="overview">{t('admin.statistics.overviewTab')}</TabsTrigger>
            <TabsTrigger value="topProducts">{t('admin.statistics.topProductsTab')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={isCustom ? 'custom' : range} onValueChange={(v) => { if (v !== 'custom') selectPreset(v as DashboardRange); }}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {t(`admin.statistics.range${r.charAt(0).toUpperCase() + r.slice(1)}` as 'admin.statistics.rangeToday')}
                </TabsTrigger>
              ))}
              <TabsTrigger value="custom">{t('admin.statistics.customRange')}</TabsTrigger>
            </TabsList>
          </Tabs>

          {isCustom && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={fromDraft}
                max={toDraft || undefined}
                onChange={(e) => setFromDraft(e.target.value)}
                className="h-8 w-36"
                aria-label={t('admin.statistics.dateFrom')}
              />
              <span className="text-muted-foreground">~</span>
              <Input
                type="date"
                value={toDraft}
                min={fromDraft || undefined}
                onChange={(e) => setToDraft(e.target.value)}
                className="h-8 w-36"
                aria-label={t('admin.statistics.dateTo')}
              />
              <Button size="sm" className="h-8" onClick={applyCustomRange}>
                {t('admin.statistics.apply')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <Tabs value={reportTab} className="contents">
        {/* ===== 总览 tab：原 W7-ext-E 三块原样迁入 ===== */}
        <TabsContent value="overview" className="space-y-6">
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
        </TabsContent>

        {/* ===== 商品排行 tab（批B 新增） ===== */}
        <TabsContent value="topProducts">
          {isCustom && custom.from && custom.to ? (
            <TopProductsTab custom={custom} />
          ) : (
            <TopProductsTab range={range} />
          )}
        </TabsContent>
      </Tabs>
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
