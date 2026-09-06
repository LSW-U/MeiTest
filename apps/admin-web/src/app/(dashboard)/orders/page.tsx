/**
 * 订单列表页 — /orders
 *
 * 后端：GET /admin/orders（W4 已实现）
 *   - status 过滤（10 种订单状态）
 *   - userId / warehouseId / orderNo 筛选
 *   - 游标分页
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import {
  useOrders,
  type OrderListItem,
  type OrderStatus,
} from '@/hooks/api/use-orders';
import { formatCurrency, formatLocaleDateTime } from '@/lib/utils';

const STATUS_FILTERS: { value: OrderStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.orders.statusAll' },
  { value: 'PENDING_PAYMENT', labelKey: 'admin.orders.statusPendingPayment' },
  { value: 'PENDING_CONFIRM', labelKey: 'admin.orders.statusPendingConfirm' },
  { value: 'CONFIRMED', labelKey: 'admin.orders.statusConfirmed' },
  { value: 'OUT_FOR_DELIVERY', labelKey: 'admin.orders.statusOutForDelivery' },
  { value: 'DELIVERED_PAID', labelKey: 'admin.orders.statusDeliveredPaid' },
  { value: 'CANCELLED', labelKey: 'admin.orders.statusCancelled' },
];

export default function OrdersListPage() {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [orderNoSearch, setOrderNoSearch] = useState('');

  const {
    data,
    isPending,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOrders({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    orderNo: orderNoSearch || undefined,
    limit: 20,
  });

  const items: OrderListItem[] = data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<OrderListItem>[] = [
    {
      key: 'orderNo',
      header: t('admin.orders.columnOrderNo'),
      render: (row) => (
        <button
          onClick={() => router.push(`/orders/${row.id}`)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.orderNo}
        </button>
      ),
    },
    {
      key: 'status',
      header: t('admin.orders.columnStatus'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'paymentStatus',
      header: t('admin.orders.columnPaymentStatus'),
      render: (row) => <StatusBadge status={row.paymentStatus} />,
    },
    {
      key: 'paymentMethod',
      header: t('admin.orders.columnPaymentMethod'),
      render: (row) => (
        <span className="text-muted-foreground">{row.paymentMethod}</span>
      ),
    },
    {
      key: 'payableAmount',
      header: t('admin.orders.columnPayableAmount'),
      render: (row) => (
        <span className="font-mono text-xs">{formatCurrency(row.payableAmount)}</span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.orders.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatLocaleDateTime(row.createdAt, locale)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.orders.title')} description={t('admin.orders.description')} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as OrderStatus | 'ALL')}
        >
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {t(s.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder={t('admin.orders.searchPlaceholder')}
          value={orderNoSearch}
          onChange={(e) => setOrderNoSearch(e.target.value)}
          className="w-64"
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.orders.empty')}
          description={t('admin.orders.emptyDescription')}
        />
      ) : (
        <>
          <DataTable data={items} columns={columns} />
          {items.length > 0 && (
            <div className="flex items-center justify-center">
              {hasNextPage ? (
                <Button
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('admin.orders.loadingMore')}
                    </>
                  ) : (
                    t('admin.orders.loadMoreButton')
                  )}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('admin.orders.noMore', { count: items.length })}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
