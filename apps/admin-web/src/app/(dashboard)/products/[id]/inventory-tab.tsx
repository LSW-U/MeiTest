/**
 * 商品详情 · 库存 tab（批C 新增，消费批B 聚合详情）
 *
 * 数据源：GET /client/products/:id/detail（批B ProductDetail，admin 复用同一公开端点）
 * 已知语义（契约注释）：
 *   - stocks[]：按仓 ACTIVE SKU 求和，warehouseId 升序；无库存记录时空数组
 *   - totalStock：恒 number（无记录时 0）
 * 状态口径：0=售罄，0<量≤LOW_STOCK_THRESHOLD=低库存，其余=有货
 */
'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { useProductDetail, type WarehouseStockView } from '@/hooks/api/use-products';

/** 低库存阈值（MVP 简化口径，常量注释便于后续抽配置） */
const LOW_STOCK_THRESHOLD = 10;

type StockLevel = 'in' | 'low' | 'out';

function stockLevel(quantity: number): StockLevel {
  if (quantity <= 0) return 'out';
  if (quantity <= LOW_STOCK_THRESHOLD) return 'low';
  return 'in';
}

export function InventoryTab({ productId }: { productId: string }) {
  const t = useTranslations('common');
  const detailQ = useProductDetail(productId);

  if (detailQ.isLoading) return <LoadingSkeleton lines={6} />;
  if (detailQ.error)
    return (
      <ErrorState message={detailQ.error.message} onRetry={() => detailQ.refetch()} />
    );

  const detail = detailQ.data?.data;

  const columns: Column<WarehouseStockView>[] = [
    {
      key: 'warehouse',
      header: t('w.products.columnWarehouse'),
      render: (row) => <span className="font-medium">{row.name?.en ?? '—'}</span>,
    },
    {
      key: 'quantity',
      header: t('w.products.columnQuantity'),
      render: (row) => <span className="font-mono text-sm">{row.quantity}</span>,
    },
    {
      key: 'level',
      header: t('w.products.columnStockStatus'),
      render: (row) => {
        const level = stockLevel(row.quantity);
        return (
          <Badge
            variant={
              level === 'out' ? 'destructive' : level === 'low' ? 'warning' : 'success'
            }
          >
            {level === 'out'
              ? t('w.products.stockOut')
              : level === 'low'
                ? t('w.products.stockLow')
                : t('w.products.stockInStock')}
          </Badge>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.products.inventoryTitle')}</CardTitle>
        {detail && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{t('w.products.totalStock')}</div>
            <div className="font-mono text-2xl font-bold">{detail.totalStock}</div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t('w.products.stockStatusHint', { threshold: LOW_STOCK_THRESHOLD })}
        </p>
        <DataTable
          data={detail?.stocks ?? []}
          columns={columns}
          rowKey={(row) => row.warehouseId}
          emptyState={
            <span className="text-sm text-muted-foreground">
              {t('w.products.stockEmptyHint')}
            </span>
          }
        />
      </CardContent>
    </Card>
  );
}
