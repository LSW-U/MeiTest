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
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCustomers,
  type CustomerListItem,
  type UserStatus,
  type UserRole,
} from '@/hooks/api/use-customers';
import { formatCurrency } from '@/lib/utils';

const STATUS_FILTERS: { value: UserStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.customers.statusAll' },
  { value: 'ACTIVE', labelKey: 'admin.customers.statusActive' },
  { value: 'SUSPENDED', labelKey: 'admin.customers.statusSuspended' },
  { value: 'DELETED', labelKey: 'admin.customers.statusDeleted' },
];

const ROLE_LABEL_KEY: Record<UserRole, string> = {
  super_admin: 'admin.customers.roleSuperAdmin',
  customer: 'admin.customers.roleCustomer',
  rider: 'admin.customers.roleRider',
  warehouse_staff: 'admin.customers.roleWarehouseStaff',
  customer_service: 'admin.customers.roleCustomerService',
};

export default function CustomersListPage() {
  const t = useTranslations('common');
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const { data, isLoading, error, refetch } = useCustomers({
    keyword: debouncedKeyword || undefined,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    page: 1,
    pageSize: 20,
  });

  const items: CustomerListItem[] = data?.items ?? [];

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
      render: (row) => (
        <span className="text-sm">{row.name ?? '-'}</span>
      ),
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
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: t('admin.customers.columnLastLoginAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleDateString() : '-'}
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
        <Input
          placeholder={t('admin.customers.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-64"
        />
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

      {data && data.total > data.items.length && (
        <div className="text-center text-xs text-muted-foreground">
          {t('admin.customers.loadMoreHint', { count: data.items.length, total: data.total })}
        </div>
      )}
    </div>
  );
}
