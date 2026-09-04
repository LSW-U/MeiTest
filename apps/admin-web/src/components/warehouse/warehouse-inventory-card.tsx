/**
 * WarehouseInventoryCard — 详情页·库存卡（Codex设计 §3.6）
 *
 * 迁移自原详情页 Tabs（库存 / 变更日志），业务逻辑不变：
 * - useStocks / useStockLogs / useAdjustStock 原样沿用
 * - 卡内局部 Tabs；独立 query，失败不影响整页
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { ErrorState } from '@/components/common/error-state';
import {
  useStocks,
  useStockLogs,
  useAdjustStock,
  type Stock,
  type StockLog,
} from '@/hooks/api/use-inventory';
import { useToast } from '@/hooks/use-toast';

export function WarehouseInventoryCard({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations('common');
  const stocksQ = useStocks({ warehouseId });
  const logsQ = useStockLogs(warehouseId);

  const stockColumns: Column<Stock>[] = [
    {
      key: 'skuId',
      header: t('w.warehouses.columnSkuId'),
      render: (row) => <code className="text-xs">{row.skuId.slice(0, 8)}...</code>,
    },
    {
      key: 'quantity',
      header: t('w.warehouses.columnQuantity'),
      render: (row) => <span className="font-mono">{row.quantity}</span>,
    },
    {
      key: 'safetyStock',
      header: t('w.warehouses.columnSafety'),
      render: (row) => (
        <span className="text-muted-foreground">{row.safetyStock ?? '—'}</span>
      ),
    },
  ];

  const logColumns: Column<StockLog>[] = [
    {
      key: 'createdAt',
      header: t('w.warehouses.columnTime'),
      render: (row) => (
        <span className="font-mono text-xs">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'skuId',
      header: t('w.warehouses.columnSku'),
      render: (row) => <code className="text-xs">{row.skuId.slice(0, 8)}...</code>,
    },
    {
      key: 'change',
      header: t('w.warehouses.columnChange'),
      render: (row) => (
        <span className={row.change >= 0 ? 'text-green-600' : 'text-destructive'}>
          {row.change >= 0 ? '+' : ''}
          {row.change}
        </span>
      ),
    },
    {
      key: 'afterQuantity',
      header: t('w.warehouses.columnAfter'),
      render: (row) => <span className="font-mono">{row.afterQuantity}</span>,
    },
    {
      key: 'reason',
      header: t('w.warehouses.columnReason'),
      render: (row) => (
        <span className="text-muted-foreground">{row.reason ?? '—'}</span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.warehouses.cardInventoryTitle')}</CardTitle>
        <AdjustStockDialog warehouseId={warehouseId} />
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="stocks">
          <TabsList>
            <TabsTrigger value="stocks">{t('w.warehouses.tabStocks')}</TabsTrigger>
            <TabsTrigger value="logs">{t('w.warehouses.tabStockLogs')}</TabsTrigger>
          </TabsList>

          <TabsContent value="stocks">
            <DataTable
              data={
                Array.isArray(stocksQ.data?.data)
                  ? (stocksQ.data.data as Stock[])
                  : (stocksQ.data?.data as { items?: Stock[] })?.items ?? []
              }
              columns={stockColumns}
              isLoading={stocksQ.isLoading}
              errorState={
                stocksQ.error ? (
                  <ErrorState message={stocksQ.error.message} onRetry={() => stocksQ.refetch()} />
                ) : null
              }
            />
          </TabsContent>

          <TabsContent value="logs">
            <DataTable
              data={logsQ.data?.data ?? []}
              columns={logColumns}
              isLoading={logsQ.isLoading}
              errorState={
                logsQ.error ? (
                  <ErrorState message={logsQ.error.message} onRetry={() => logsQ.refetch()} />
                ) : null
              }
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** 调整库存 Dialog（审查 P3-3：mutateAsync + await + 失败保留 Dialog 与输入，不再 fire-and-forget） */
function AdjustStockDialog({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations('common');
  const adjustMutation = useAdjustStock();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [skuId, setSkuId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = parseInt(delta, 10);
    if (isNaN(d) || !skuId) return;
    try {
      await adjustMutation.mutateAsync({
        warehouseId,
        skuId,
        delta: d,
        reason: reason || undefined,
      });
      setOpen(false);
      setSkuId('');
      setDelta('');
      setReason('');
    } catch (err) {
      // 调整失败：Dialog 保留，输入不丢
      toast({
        title: t('w.form.saveFailed', { message: (err as Error).message }),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('w.warehouses.adjustStock')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.warehouses.adjustStockDialogTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>{t('w.warehouses.skuIdLabel')}</Label>
            <Input
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              placeholder={t('w.warehouses.skuIdPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>{t('w.warehouses.deltaLabel')}</Label>
            <Input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder={t('w.warehouses.deltaPlaceholder')}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>{t('w.warehouses.reasonLabel')}</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('w.warehouses.reasonPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('w.form.cancel')}
            </Button>
            <Button type="submit" disabled={adjustMutation.isPending}>
              {adjustMutation.isPending ? t('w.form.adjusting') : t('w.form.confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
