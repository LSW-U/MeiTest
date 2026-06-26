/**
 * 商品列表页 — /products
 *
 * W3-W 收尾：用 DataTable + useProducts hook 替代 W2-W 的裸 table
 * 后端：GET /admin/products
 */
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { useProducts, type Product } from '@/hooks/api/use-products';
import { useUpdateProductStatus } from '@/hooks/api/use-products';
import { formatCurrency } from '@/lib/utils';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';

export default function ProductsListPage() {
  const t = useTranslations();
  const router = useRouter();
  const { immediateValue, debouncedValue, setImmediateValue } = useDebouncedSearch('');

  const { data, isLoading, error, refetch } = useProducts({ search: debouncedValue });
  const statusMutation = useUpdateProductStatus();

  const items: Product[] = Array.isArray(data?.data) ? data.data : [];

  const columns: Column<Product>[] = [
    {
      key: 'mainImage',
      header: 'Image',
      render: (row) =>
        row.mainImage ? (
          <img
            src={row.mainImage}
            alt=""
            className="h-10 w-10 rounded object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
            —
          </div>
        ),
    },
    {
      key: 'name',
      header: 'Name (EN)',
      render: (row) => <span className="font-medium">{row.name?.en ?? '—'}</span>,
    },
    {
      key: 'nameZh',
      header: 'Name (ZH)',
      render: (row) => <span className="text-muted-foreground">{row.name?.zh ?? '—'}</span>,
    },
    {
      key: 'priceMin',
      header: 'Min Price',
      render: (row) =>
        row.priceMin != null ? (
          <span className="font-mono text-xs">{formatCurrency(row.priceMin)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'salesCount',
      header: 'Sales',
      render: (row) => <span className="text-muted-foreground">{row.salesCount ?? 0}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('w.products.title')}
        description={t('w.products.listDesc')}
        action={
          <Button onClick={() => router.push('/products/create')}>
            <Plus className="mr-2 h-4 w-4" />
            {t('w.products.create')}
          </Button>
        }
      />
      <DataTable
        data={items}
        columns={columns}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/products/${row.id}`)}
        toolbar={
          <DataTableToolbar
            searchValue={immediateValue}
            onSearchChange={setImmediateValue}
            searchPlaceholder={t('w.products.searchPlaceholder')}
          />
        }
        emptyState={
          <EmptyState
            title={t('w.table.empty')}
            description={t('w.products.emptyDesc')}
          />
        }
        errorState={
          error ? <ErrorState message={String(error.message)} onRetry={() => refetch()} /> : null
        }
        rowActions={(row) => (
          <div className="flex justify-end">
            <Button
              variant={row.status === 'ACTIVE' ? 'destructive' : 'default'}
              size="sm"
              disabled={row.status === 'OUT_OF_STOCK' || statusMutation.isPending}
              onClick={(e) => {
                e.stopPropagation();
                statusMutation.mutate({
                  id: row.id,
                  status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                });
              }}
            >
              {row.status === 'ACTIVE' ? t('w.status.toggle_off') : t('w.status.toggle_on')}
            </Button>
          </div>
        )}
      />
    </>
  );
}
