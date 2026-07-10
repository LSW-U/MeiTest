/**
 * 客户管理列表页 - /customers
 *
 * 后端：GET /admin/users（W7 P1-2 列表 + W7-feature 详情/动作）
 *   - status 过滤（ACTIVE / SUSPENDED / DELETED）
 *   - role 过滤（5 个角色）
 *   - keyword 模糊搜索（phone/email/name）
 *   - 分页（page + pageSize，offset-based）
 */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useFormatter } from 'next-intl';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCustomers,
  type CustomerListItem,
} from '@/hooks/api/use-customers';
import { formatCurrency } from '@/lib/utils';
import { ROLE_LABEL_KEY, type UserStatus } from './_constants';

const STATUS_FILTERS: { value: UserStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.customers.statusAll' },
  { value: 'ACTIVE', labelKey: 'admin.customers.statusActive' },
  { value: 'SUSPENDED', labelKey: 'admin.customers.statusSuspended' },
  { value: 'DELETED', labelKey: 'admin.customers.statusDeleted' },
];

const PAGE_SIZE = 20;

export default function CustomersListPage() {
  const t = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  // 切 status 或 keyword 清空时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedKeyword]);

  const { data, isPending, isFetching, error, refetch } = useCustomers({
    keyword: debouncedKeyword || undefined,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    page,
    pageSize: PAGE_SIZE,
  });

  const items: CustomerListItem[] = data?.items ?? [];
  const isLoading = isPending || isFetching;

  function formatDate(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  const columns: Column<CustomerListItem>[] = [
    {
      key: 'phone',
      header: t('admin.customers.columnPhone'),
      render: (row) => (
        <button
          onClick={() => router.push(`/customers/${row.id}`)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.phone}
        </button>
      ),
    },
    {
      key: 'name',
      header: t('admin.customers.columnName'),
      render: (row) => <span className="text-sm">{row.name ?? '-'}</span>,
    },
    {
      key: 'role',
      header: t('admin.customers.columnRole'),
      render: (row) => (
        <Badge variant="outline">{t(ROLE_LABEL_KEY[row.role])}</Badge>
      ),
    },
    {
      key: 'status',
      header: t('admin.customers.columnStatus'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'orderCount',
      header: t('admin.customers.columnOrderCount'),
      render: (row) => <span className="font-mono text-xs">{row.orderCount}</span>,
    },
    {
      key: 'totalSpent',
      header: t('admin.customers.columnTotalSpent'),
      render: (row) => (
        <span className="font-mono text-xs">{formatCurrency(row.totalSpent)}</span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.customers.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: t('admin.customers.columnLastLoginAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.lastLoginAt ? formatDate(row.lastLoginAt) : '-'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.customers.title')} description={t('admin.customers.description')} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as UserStatus | 'ALL')}
        >
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {t(s.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-64">
          <Input
            placeholder={t('admin.customers.searchPlaceholder')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pr-8"
          />
          {keyword && (
            <button
              onClick={() => setKeyword('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
              aria-label={t('admin.customers.clearSearch')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.customers.empty')}
          description={t('admin.customers.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t('admin.customers.pageInfo', {
              page: data.page,
              total: Math.ceil(data.total / PAGE_SIZE),
              count: data.items.length,
              totalItems: data.total,
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('admin.customers.prevPage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.hasMore}
            >
              {t('admin.customers.nextPage')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
