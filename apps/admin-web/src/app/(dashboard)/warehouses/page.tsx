/**
 * 仓库列表页 — /warehouses
 *
 * 后端：GET /admin/warehouses（含 stockSummary，批 B）
 *
 * 批 C1（Codex设计 §2）：
 * - toolbar：code/name 搜索 + ACTIVE/INACTIVE 状态筛选（前端过滤，仓库量少）
 * - 新增列：SKU 数 / 总库存量 / 仅可售（stockSummary 缺失显示 —）
 * - 负载列：C2 占位 Badge，不请求 dispatch 接口（拍板：C1 不做负载）
 */
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWarehouses, type Warehouse } from '@/hooks/api/use-warehouses';
import { formatCurrency } from '@/lib/utils';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** 搜索匹配：code 或 name 任一语言命中（大小写不敏感，Codex设计 §2.1 伪代码） */
const NAME_LOCALES = ['en', 'zh', 'id', 'pt'] as const;

function matchKeyword(row: Warehouse, keyword: string): boolean {
  const lower = keyword.trim().toLowerCase();
  if (!lower) return true;
  return (
    row.code.toLowerCase().includes(lower) ||
    NAME_LOCALES.some((lang) =>
      (row.name?.[lang] ?? '').toLowerCase().includes(lower),
    )
  );
}

export default function WarehousesListPage() {
  const t = useTranslations('common');
  const router = useRouter();
  const { data, isLoading, error, refetch } = useWarehouses();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const items: Warehouse[] = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(() => {
    return items.filter((row) => {
      if (statusFilter === 'ACTIVE' && !row.isActive) return false;
      if (statusFilter === 'INACTIVE' && row.isActive) return false;
      return matchKeyword(row, keyword);
    });
  }, [items, keyword, statusFilter]);

  const hasFilters = keyword.trim() !== '' || statusFilter !== 'ALL';

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
      key: 'skuCount',
      header: t('w.warehouses.columnSkuCount'),
      render: (row) => (
        <span className="font-mono text-xs">{row.stockSummary?.skuCount ?? '—'}</span>
      ),
    },
    {
      key: 'totalQuantity',
      header: t('w.warehouses.columnTotalQuantity'),
      render: (row) => (
        <span className="font-mono text-xs">{row.stockSummary?.totalQuantity ?? '—'}</span>
      ),
    },
    {
      key: 'sellableQuantity',
      header: t('w.warehouses.columnSellableQuantity'),
      render: (row) => (
        <span className="font-mono text-xs">{row.stockSummary?.sellableQuantity ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('w.warehouses.columnIsActive'),
      render: (row) => (
        <StatusBadge
          status={row.isActive ? 'ACTIVE' : 'INACTIVE'}
          label={
            row.isActive
              ? t('w.warehouses.filterStatusActive')
              : t('w.warehouses.filterStatusInactive')
          }
        />
      ),
    },
    {
      key: 'load',
      header: t('w.warehouses.columnLoad'),
      // C2 占位：不请求 dispatch 接口（Codex设计 §7）
      render: () => (
        <Badge variant="outline" className="text-muted-foreground">
          {t('w.warehouses.loadPlaceholderC2')}
        </Badge>
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
        data={filtered}
        columns={columns}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/warehouses/${row.id}`)}
        toolbar={
          <>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('w.warehouses.searchPlaceholder')}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('w.warehouses.filterStatusAll')}</SelectItem>
                <SelectItem value="ACTIVE">{t('w.warehouses.filterStatusActive')}</SelectItem>
                <SelectItem value="INACTIVE">{t('w.warehouses.filterStatusInactive')}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        emptyState={
          items.length === 0 ? (
            <EmptyState
              title={t('w.warehouses.emptyTitle')}
              description={t('w.warehouses.emptyHint')}
            />
          ) : (
            // 筛选后无结果：与「暂无仓库」区分（Codex设计 §1.5）
            <EmptyState
              title={t('w.warehouses.noMatchTitle')}
              description={t('w.warehouses.noMatchHint')}
              action={
                hasFilters ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setKeyword('');
                      setStatusFilter('ALL');
                    }}
                  >
                    {t('w.warehouses.clearFilters')}
                  </Button>
                ) : null
              }
            />
          )
        }
        errorState={
          error ? <ErrorState message={error.message} onRetry={() => refetch()} /> : null
        }
      />
    </>
  );
}
