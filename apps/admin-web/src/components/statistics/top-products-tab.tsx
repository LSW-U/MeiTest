/**
 * 商品销量排行 tab - statistics 页（数据分析报表模块 批B，2026-09-10）
 *
 * 后端：GET /admin/statistics/products/top（R9：OrderItem 区间聚合，金额单位分）
 *       GET /admin/statistics/products/export?...&lang=（CSV，lang 显式传——locale 在 cookie）
 *
 * 时间范围：页头公共选择器传入（预设三值 或 自定义 from/to）
 */
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTopProducts } from '@/hooks/api/use-statistics';
import { API_BASE_URL } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export interface TopProductsTabProps {
  /** 预设范围（自定义时为 undefined） */
  range?: 'today' | 'week' | 'month';
  /** 自定义范围（预设时为 undefined），YYYY-MM-DD 含头尾 */
  custom?: { from: string; to: string };
  limit?: number;
}

export function TopProductsTab({ range, custom, limit = 10 }: TopProductsTabProps) {
  const t = useTranslations('common');
  const format = useFormatter();

  const { data, isPending, error, refetch } = useTopProducts({ range, custom, limit });
  const items = data?.items ?? [];

  /** 横向条形图数据（Top 5，商品名截断 18 字符防轴标签过长） */
  const chartData = items.slice(0, 5).map((it) => ({
    name: it.productName.length > 18 ? `${it.productName.slice(0, 18)}…` : it.productName,
    gmv: it.gmvAmount / 100,
  }));

  function handleExport() {
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (custom) {
      params.set('from', custom.from);
      params.set('to', custom.to);
    }
    // lang 定死 query 显式传（locale 在 documentElement.lang，cookie 不随请求走）
    params.set('lang', document.documentElement.lang || 'en');
    // 与 apiFetch 同源拼绝对地址（admin-web :3001 与 API :3000 不同源，相对路径会打到 :3001 页面路由 404；
    // top-level GET 跨源导航 SameSite=Lax cookie 会带，无 CSRF 拦截问题）
    window.open(`${API_BASE_URL}/admin/statistics/products/export?${params.toString()}`, '_blank');
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
          <CardTitle>{t('admin.statistics.topProductsTab')}</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              title={t('admin.statistics.empty')}
              description={t('admin.statistics.noTopProducts')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t('admin.statistics.rank')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('admin.statistics.product')}</th>
                    <th className="pb-2 pr-4 text-right font-medium">{t('admin.statistics.gmv')}</th>
                    <th className="pb-2 pr-4 text-right font-medium">{t('admin.statistics.orderCount')}</th>
                    <th className="pb-2 text-right font-medium">{t('admin.statistics.quantitySold')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.productId} className="border-b last:border-0">
                      <td className="py-2 pr-4">{idx + 1}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          {it.productImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={it.productImage}
                              alt=""
                              className="h-8 w-8 rounded object-cover"
                            />
                          ) : null}
                          <span className="max-w-56 truncate">{it.productName}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(it.gmvAmount)}</td>
                      <td className="py-2 pr-4 text-right">{format.number(it.orderCount)}</td>
                      <td className="py-2 text-right">{format.number(it.quantitySold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.statistics.gmv')} · Top 5</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
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
                  formatter={(value) => {
                    const v = Number(value);
                    return [
                      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v),
                      t('admin.statistics.gmv'),
                    ];
                  }}
                />
                <Bar dataKey="gmv" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
