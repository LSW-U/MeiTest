/**
 * 仪表盘首页 — /（(dashboard)/page.tsx）
 *
 * 合并旧 /platform 数据面板（W2-M）到新 shadcn UI（W3-W）
 * 后端：GET /admin/platform/dashboard/summary?range=today|week|month
 *
 * 视角：platform 看全部 KPI；其他视角只看 W 流程统计（商品/仓库/分类）
 */
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, AlertCircle, ShoppingCart, Bike } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import { usePerspectiveStore } from '@/stores/perspective';
import { cn } from '@/lib/utils';
import type { components } from '@meimart/shared-types';

type DashboardSummary = components['schemas']['DashboardSummary'];
type TimeRange = 'today' | 'week' | 'month';

const RANGES: { value: TimeRange; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
];

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

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

export default function DashboardPage() {
  const perspective = usePerspectiveStore((s) => s.perspective);
  const [range, setRange] = useState<TimeRange>('today');

  const { data, isLoading, error, refetch } = useDashboardSummary(range);

  // platform 视角看完整 KPI；其他视角回退到 W 流程占位
  if (perspective !== 'platform') {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Dashboard" />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            当前视角 <span className="font-medium text-foreground">{perspective}</span> 暂未提供专属仪表盘。
            切到 platform 视角查看完整 KPI（GMV / 订单 / 在线骑手 / 异常订单）。
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Platform Dashboard"
        description="实时业务 KPI + 趋势分析"
        action={
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                size="sm"
                variant={range === r.value ? 'default' : 'outline'}
                onClick={() => setRange(r.value)}
              >
                {r.label}
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
              title="GMV"
              icon={TrendingUp}
              value={data ? formatMoney(data.gmv) : undefined}
              growth={data?.gmvGrowthPct}
              loading={isLoading}
            />
            <KpiCard
              title="订单数"
              icon={ShoppingCart}
              value={data ? data.orderCount.toLocaleString() : undefined}
              growth={data?.orderCountGrowthPct}
              loading={isLoading}
            />
            <KpiCard
              title="在线骑手"
              icon={Bike}
              value={data ? data.onlineRiderCount.toString() : undefined}
              loading={isLoading}
            />
            <KpiCard
              title="异常订单"
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
                <CardTitle className="text-sm">GMV / 订单趋势</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : data && data.trend.length > 0 ? (
                  <TrendBars points={data.trend} />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    暂无趋势数据
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Warehouse Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">仓库维度钻取</CardTitle>
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
                          <div className="font-mono text-xs">{formatMoney(w.gmv)}</div>
                          <div className="text-xs text-muted-foreground">
                            {w.orderCount} 单 · {w.abnormalCount} 异常
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    暂无仓库数据
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 时间范围信息 */}
          {data && (
            <div className="text-xs text-muted-foreground">
              数据范围：{new Date(data.from).toLocaleString()} ~{' '}
              {new Date(data.to).toLocaleString()}
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
                {formatGrowth(growth)} vs 上周期
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
  const maxGmv = Math.max(...points.map((p) => p.gmv), 1);
  return (
    <div className="flex h-40 items-end gap-1">
      {points.map((p) => (
        <div
          key={p.bucket}
          title={`${p.bucket}: ${formatMoney(p.gmv)} (${p.orderCount} orders)`}
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
