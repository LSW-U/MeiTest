/**
 * 仓库列表页 — /warehouses
 *
 * 后端：GET /admin/warehouses
 */
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { useWarehouses, type Warehouse } from '@/hooks/api/use-warehouses';
import { formatCurrency } from '@/lib/utils';

export default function WarehousesListPage() {
  const t = useTranslations('common');
  const router = useRouter();
  const { data, isLoading, error, refetch } = useWarehouses();

  const items: Warehouse[] = data?.data ?? [];

  const columns: Column<Warehouse>[] = [
    {
      key: 'code',
      header: t('w.warehouses.columnCode'),
      render: (row) => <code className="text-xs font-mono">{row.code}</code>,
    },
    {
      key: 'name',
      header: t('w.warehouses.columnNameEn'),
      render: (row) => <span className="font-medium">{row.name?.en ?? row.name?.zh ?? '—'}</span>,
    },
    {
      key: 'address',
      header: t('w.warehouses.columnAddress'),
      render: (row) => <span className="text-muted-foreground">{row.address}</span>,
    },
    {
      key: 'center',
      header: t('w.warehouses.columnCenter'),
      render: (row) => (
        <span className="font-mono text-xs">
          {row.centerLat.toFixed(4)}, {row.centerLng.toFixed(4)}
        </span>
      ),
    },
    {
      key: 'deliveryFee',
      header: t('w.warehouses.columnDeliveryFee'),
      render: (row) => (
        <span className="font-mono text-xs">{formatCurrency(row.deliveryFee)}</span>
      ),
    },
    {
      key: 'isActive',
      header: t('w.warehouses.columnIsActive'),
      render: (row) => (
        <span className={row.isActive ? 'text-green-600' : 'text-muted-foreground'}>
          {row.isActive
            ? t('w.warehouses.placeholderStatusActive')
            : t('w.warehouses.placeholderStatusInactive')}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('w.warehouses.title') as string}
        description={t('w.warehouses.listDesc')}
        action={
          <Button onClick={() => router.push('/warehouses/create')}>
            <Plus className="mr-2 h-4 w-4" />
            {t('w.warehouses.newWarehouse')}
          </Button>
        }
      />
      <DataTable
        data={items}
        columns={columns}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/warehouses/${row.id}`)}
        emptyState={
          <EmptyState
            title={t('w.warehouses.emptyTitle')}
            description={t('w.warehouses.emptyHint')}
          />
        }
        errorState={
          error ? <ErrorState message={error.message} onRetry={() => refetch()} /> : null
        }
      />
    </>
  );
}
