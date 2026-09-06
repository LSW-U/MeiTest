/**
 * 仪表盘首页 — /（(dashboard)/page.tsx）
 *
 * 合并旧 /platform 数据面板（W2-M）到新 shadcn UI（W3-W）
 * 后端：GET /admin/platform/dashboard/summary?range=today|week|month
 *
 * 视角（批次 2.2 改造）：
 *   - platform：完整 KPI（GMV/订单/骑手/异常）+ 趋势 + 仓库钻取
 *   - merchant/warehouse/support/rider-mgmt：精简看板（KPI 子集 + 快捷入口）
 *   - 数据源同 summary 端点（MVP 单商家，视角差异通过 KPI 子集 + 文案体现，不改后端）
 *   - 真实 per-perspective 端点（每视角专属数据维度）留批次 3-5
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, AlertCircle, ShoppingCart, Bike } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { apiFetch, type ApiSuccess, type Perspective } from '@/lib/api';
import { usePerspectiveStore } from '@/stores/perspective';
import { cn, formatCurrency, formatLocaleDateTime } from '@/lib/utils';
import type { components } from '@meimart/shared-types';

type DashboardSummary = components['schemas']['DashboardSummary'];
type TimeRange = 'today' | 'week' | 'month';

const RANGES: TimeRange[] = ['today', 'week', 'month'];

function formatGrowth(pct: number): string {
  if (pct === 0) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function displayName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, string>;
    return record.zh ?? record.en ?? record.id ?? record.pt ?? Object.values(record)[0] ?? '';
  }
  return '';
}

function useDashboardSummary(range: TimeRange) {
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary', range],
    queryFn: () =>
      apiFetch<ApiSuccess<DashboardSummary>>(
        `/admin/platform/dashboard/summary?range=${range}`,
      ).then((res) => res.data),
    retry: false,
  });
}

// === 批次 2.2：非 platform 视角的 KPI + 快捷入口配置 ===
type KpiKey = 'gmv' | 'orderCount' | 'onlineRiders' | 'abnormalOrders';

/** 非 platform 视角（用于 narrow 类型） */
type NonPlatformPerspective = Exclude<Perspective, 'platform'>;

const KPI_CONFIG: Record<
  KpiKey,
  {
    titleKey: string;
    icon: React.ComponentType<{ className?: string }>;
    getValue: (d: DashboardSummary) => string;
    getGrowth?: (d: DashboardSummary) => number | undefined;
    getVariant?: (d: DashboardSummary) => 'default' | 'destructive';
  }
> = {
  gmv: {
    titleKey: 'dashboard.gmv',
    icon: TrendingUp,
    getValue: (d) => formatCurrency(d.gmv),
    getGrowth: (d) => d.gmvGrowthPct,
  },
  orderCount: {
    titleKey: 'dashboard.orderCount',
    icon: ShoppingCart,
    getValue: (d) => d.orderCount.toLocaleString(),
    getGrowth: (d) => d.orderCountGrowthPct,
  },
  onlineRiders: {
    titleKey: 'dashboard.onlineRiders',
    icon: Bike,
    getValue: (d) => d.onlineRiderCount.toString(),
  },
  abnormalOrders: {
    titleKey: 'dashboard.abnormalOrders',
    icon: AlertCircle,
    getValue: (d) => d.abnormalOrderCount.toString(),
    getVariant: (d) => (d.abnormalOrderCount > 0 ? 'destructive' : 'default'),
  },
};

/** 每视角显示哪些 KPI（复用 platform summary 数据，MVP 单商家口径一致） */
const PERSPECTIVE_KPI: Record<NonPlatformPerspective, KpiKey[]> = {
  merchant: ['gmv', 'orderCount', 'abnormalOrders'],
  warehouse: ['orderCount', 'abnormalOrders'],
  support: ['abnormalOrders', 'orderCount'],
  'rider-mgmt': ['onlineRiders', 'abnormalOrders'],
};

/** 每视角快捷入口（链接到该视角主要工作页面，批次 3-5 后端补强后再细化） */
const PERSPECTIVE_ACTIONS: Record<
  NonPlatformPerspective,
  { href: string; labelKey: string }[]
> = {
  merchant: [
    { href: '/products', labelKey: 'dashboard.merchant.actionProducts' },
    { href: '/orders', labelKey: 'dashboard.merchant.actionOrders' },
    { href: '/refunds', labelKey: 'dashboard.merchant.actionRefunds' },
    { href: '/promotions', labelKey: 'dashboard.merchant.actionPromotions' },
  ],
  warehouse: [
    { href: '/orders', labelKey: 'dashboard.warehouse.actionOrders' },
    { href: '/warehouses', labelKey: 'dashboard.warehouse.actionWarehouses' },
    { href: '/products', labelKey: 'dashboard.warehouse.actionProducts' },
  ],
  support: [
    { href: '/refunds', labelKey: 'dashboard.support.actionRefunds' },
    { href: '/reviews', labelKey: 'dashboard.support.actionReviews' },
    { href: '/customers', labelKey: 'dashboard.support.actionCustomers' },
  ],
  'rider-mgmt': [
    { href: '/riders', labelKey: 'dashboard.riderMgmt.actionRiders' },
    { href: '/orders', labelKey: 'dashboard.riderMgmt.actionOrders' },
  ],
};

export default function DashboardPage() {
  const t = useTranslations('platform');
  const locale = useLocale();
  const perspective = usePerspectiveStore((s) => s.perspective);
  const [range, setRange] = useState<TimeRange>('today');

  const { data, isLoading, error, refetch } = useDashboardSummary(range);

  // 非 platform 视角：精简看板（KPI 子集 + 快捷入口，批次 2.2）
  if (perspective !== 'platform') {
    return (
      <PerspectiveDashboard
        perspective={perspective}
        data={data}
        isLoading={isLoading}
        error={error}
        refetch={refetch}
        range={range}
        setRange={setRange}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        action={
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? 'default' : 'outline'}
                onClick={() => setRange(r)}
              >
                {t(`dashboard.range.${r}`)}
              </Button>
            ))}
          </div>
        }
      />

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          {/* KPI 卡片 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title={t('dashboard.gmv')}
              icon={TrendingUp}
              value={data ? formatCurrency(data.gmv) : undefined}
              growth={data?.gmvGrowthPct}
              loading={isLoading}
            />
            <KpiCard
              title={t('dashboard.orderCount')}
              icon={ShoppingCart}
              value={data ? data.orderCount.toLocaleString() : undefined}
              growth={data?.orderCountGrowthPct}
              loading={isLoading}
            />
            <KpiCard
              title={t('dashboard.onlineRiders')}
              icon={Bike}
              value={data ? data.onlineRiderCount.toString() : undefined}
              loading={isLoading}
            />
            <KpiCard
              title={t('dashboard.abnormalOrders')}
              icon={AlertCircle}
              value={data ? data.abnormalOrderCount.toString() : undefined}
              loading={isLoading}
              variant={data && data.abnormalOrderCount > 0 ? 'destructive' : 'default'}
            />
          </div>

          {/* 趋势 + 仓库钻取 */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Trend（占 2 列） */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm">{t('dashboard.trendTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : data && data.trend.length > 0 ? (
                  <TrendBars points={data.trend} />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    {t('dashboard.noTrendData')}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Warehouse Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('dashboard.warehouseBreakdownTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : data && data.warehouseBreakdown.length > 0 ? (
                  <div className="space-y-2">
                    {data.warehouseBreakdown.map((w) => (
                      <div
                        key={w.warehouseId}
                        className="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0"
                      >
                        <span className="font-medium">{displayName(w.warehouseName)}</span>
                        <div className="text-right">
                          <div className="font-mono text-xs">{formatCurrency(w.gmv)}</div>
                          <div className="text-xs text-muted-foreground">
                            {t('dashboard.breakdownItem', {
                              orders: w.orderCount,
                              abnormal: w.abnormalCount,
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    {t('dashboard.noWarehouseData')}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 时间范围信息 */}
          {data && (
            <div className="text-xs text-muted-foreground">
              {t('dashboard.dataRangeLabel')} {formatLocaleDateTime(data.from, locale)} ~{' '}
              {formatLocaleDateTime(data.to, locale)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 非 platform 视角精简看板（KPI 子集 + 快捷入口，批次 2.2） */
function PerspectiveDashboard({
  perspective,
  data,
  isLoading,
  error,
  refetch,
  range,
  setRange,
}: {
  perspective: NonPlatformPerspective;
  data: DashboardSummary | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  range: TimeRange;
  setRange: (r: TimeRange) => void;
}) {
  const t = useTranslations('platform');
  const locale = useLocale();
  // i18n key 用驼峰（rider-mgmt → riderMgmt）
  const subKey = perspective === 'rider-mgmt' ? 'riderMgmt' : perspective;
  const kpis = PERSPECTIVE_KPI[perspective];
  const actions = PERSPECTIVE_ACTIONS[perspective];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t(`dashboard.${subKey}.title`)}
        description={t(`dashboard.${subKey}.description`)}
        action={
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? 'default' : 'outline'}
                onClick={() => setRange(r)}
              >
                {t(`dashboard.range.${r}`)}
              </Button>
            ))}
          </div>
        }
      />

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {kpis.map((k) => {
              const cfg = KPI_CONFIG[k];
              return (
                <KpiCard
                  key={k}
                  title={t(cfg.titleKey)}
                  icon={cfg.icon}
                  value={data ? cfg.getValue(data) : undefined}
                  growth={data && cfg.getGrowth ? cfg.getGrowth(data) : undefined}
                  loading={isLoading}
                  variant={data && cfg.getVariant ? cfg.getVariant(data) : undefined}
                />
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('dashboard.quickActions')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button key={a.href} variant="outline" asChild>
                    <Link href={a.href}>{t(a.labelKey)}</Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {data && (
            <div className="text-xs text-muted-foreground">
              {t('dashboard.dataRangeLabel')} {formatLocaleDateTime(data.from, locale)} ~{' '}
              {formatLocaleDateTime(data.to, locale)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface KpiCardProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  value?: string;
  growth?: number;
  loading?: boolean;
  variant?: 'default' | 'destructive';
}

function KpiCard({ title, icon: Icon, value, growth, loading, variant }: KpiCardProps) {
  const t = useTranslations('platform');
  return (
    <Card className={variant === 'destructive' ? 'border-destructive' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon
          className={cn(
            'h-4 w-4',
            variant === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value ?? '—'}</div>
            {growth !== undefined && (
              <div
                className={cn(
                  'mt-1 flex items-center gap-1 text-xs',
                  growth > 0 ? 'text-green-600' : growth < 0 ? 'text-red-600' : 'text-muted-foreground',
                )}
              >
                {growth > 0 && <TrendingUp className="h-3 w-3" />}
                {growth < 0 && <TrendingDown className="h-3 w-3" />}
                {formatGrowth(growth)} {t('dashboard.growth')}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TrendBars({
  points,
}: {
  points: Array<{ bucket: string; gmv: number; orderCount: number }>;
}) {
  const t = useTranslations('platform');
  const maxGmv = Math.max(...points.map((p) => p.gmv), 1);
  return (
    <div className="flex h-40 items-end gap-1">
      {points.map((p) => (
        <div
          key={p.bucket}
          title={t('dashboard.trendTooltip', {
            bucket: p.bucket,
            gmv: formatCurrency(p.gmv),
            orders: p.orderCount,
          })}
          className={cn(
            'flex-1 min-w-[2px] rounded-t',
            p.gmv > 0 ? 'bg-primary' : 'bg-muted',
          )}
          style={{
            height: `${Math.max((p.gmv / maxGmv) * 100, 2)}%`,
          }}
        />
      ))}
    </div>
  );
}
