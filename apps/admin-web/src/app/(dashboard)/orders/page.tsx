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
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useOrders,
  type OrderListItem,
  type OrderStatus,
} from '@/hooks/api/use-orders';
import { formatCurrency } from '@/lib/utils';

const STATUS_FILTERS: { value: OrderStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'PENDING_PAYMENT', label: '待支付' },
  { value: 'PENDING_CONFIRM', label: '待确认' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'OUT_FOR_DELIVERY', label: '配送中' },
  { value: 'DELIVERED_PAID', label: '已送达' },
  { value: 'CANCELLED', label: '已取消' },
];

export default function OrdersListPage() {
  const t = useTranslations();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [orderNoSearch, setOrderNoSearch] = useState('');

  const { data, isLoading, error, refetch } = useOrders({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    orderNo: orderNoSearch || undefined,
    limit: 20,
  });

  const items: OrderListItem[] = data?.items ?? [];

  const columns: Column<OrderListItem>[] = [
    {
      key: 'orderNo',
      header: '订单号',
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
      header: '状态',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'paymentStatus',
      header: '支付',
      render: (row) => <StatusBadge status={row.paymentStatus} />,
    },
    {
      key: 'paymentMethod',
      header: '支付方式',
      render: (row) => (
        <span className="text-muted-foreground">{row.paymentMethod}</span>
      ),
    },
    {
      key: 'payableAmount',
      header: '应付金额',
      render: (row) => (
        <span className="font-mono text-xs">{formatCurrency(row.payableAmount)}</span>
      ),
    },
    {
      key: 'createdAt',
      header: '下单时间',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('nav.orders')} description="订单管理系统" />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as OrderStatus | 'ALL')}
        >
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="按订单号搜索（如 MM2026062...）"
          value={orderNoSearch}
          onChange={(e) => setOrderNoSearch(e.target.value)}
          className="w-64"
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">加载中...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="暂无订单"
          description={statusFilter === 'ALL' ? '还没有任何订单' : `无 ${statusFilter} 状态订单`}
        />
      ) : (
        <>
          <DataTable data={items} columns={columns} />
          {data?.hasMore && (
            <div className="text-center text-xs text-muted-foreground">
              还有更多订单（{items.length} 已显示，游标分页加载更多待 W5 接入）
            </div>
          )}
        </>
      )}
    </div>
  );
}
