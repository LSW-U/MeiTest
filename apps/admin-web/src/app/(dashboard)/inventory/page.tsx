/**
 * 库存管理页 — /inventory（批次 5）
 *
 * 后端：apps/api/src/modules/inventory/inventory.controller.ts
 *   - GET    /admin/inventory/stocks              库存列表（warehouseId/lowStockOnly filter）
 *   - POST   /admin/inventory/stocks/batch-adjust 批量调整（全事务，上限 100）
 *   - POST   /admin/inventory/transfer            仓库间调拨（双仓原子）
 *   - GET    /admin/inventory/transfers           调拨记录（按 referenceId 聚合）
 *   - GET    /admin/inventory/stocks/export       CSV 导出
 *   - POST   /admin/inventory/stocks/import       CSV 导入（multipart，failedRows）
 *
 * 视角：platform + warehouse
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  useStocks,
  useBatchAdjustStock,
  useTransferStock,
  useTransfers,
  useImportStocksCsv,
  exportStocksCsv,
  type Stock,
  type BatchAdjustItem,
  type TransferItemInput,
  type TransferRecord,
  type ImportResultData,
} from '@/hooks/api/use-inventory';
import { ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface BatchRow {
  warehouseId: string;
  skuId: string;
  deltaQty: string;
  reason: string;
}

interface TransferRow {
  skuId: string;
  quantity: string;
}

export default function InventoryPage() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [warehouseId, setWarehouseId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([
    { warehouseId: '', skuId: '', deltaQty: '', reason: '' },
  ]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    fromWarehouseId: '',
    toWarehouseId: '',
  });
  const [transferRows, setTransferRows] = useState<TransferRow[]>([
    { skuId: '', quantity: '' },
  ]);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResultData | null>(null);

  const stocksQuery = useStocks({
    warehouseId: warehouseId || undefined,
  });
  const transfersQuery = useTransfers({ limit: 20 });
  const batchMutation = useBatchAdjustStock();
  const transferMutation = useTransferStock();
  const importMutation = useImportStocksCsv();

  // useStocks 返 { success, data: Stock[] | { items } }，取 data
  const stocksPayload = stocksQuery.data?.data;
  const rawStocks: Stock[] = Array.isArray(stocksPayload)
    ? stocksPayload
    : stocksPayload?.items ?? [];
  const stocks = lowStockOnly
    ? rawStocks.filter((s) => s.quantity <= (s.safetyStock ?? 0))
    : rawStocks;

  const transfers: TransferRecord[] = transfersQuery.data ?? [];

  function toastError(err: unknown, fallbackKey: string) {
    const message = err instanceof ApiError ? err.message : t(fallbackKey);
    toast({ title: t(fallbackKey), description: message, variant: 'destructive' });
  }

  async function handleBatchSubmit() {
    const items: BatchAdjustItem[] = batchRows
      .filter((r) => r.warehouseId && r.skuId && r.deltaQty)
      .map((r) => ({
        warehouseId: r.warehouseId,
        skuId: r.skuId,
        deltaQty: Number(r.deltaQty),
        reason: r.reason || undefined,
      }))
      .filter((r) => Number.isInteger(r.deltaQty) && r.deltaQty !== 0);
    if (items.length === 0) {
      toast({ title: t('admin.inventory.toastFailed'), description: t('admin.inventory.noValidRows'), variant: 'destructive' });
      return;
    }
    try {
      await batchMutation.mutateAsync(items);
      toast({ title: t('admin.inventory.toastBatchSuccess') });
      setBatchOpen(false);
      setBatchRows([{ warehouseId: '', skuId: '', deltaQty: '', reason: '' }]);
    } catch (err) {
      toastError(err, 'admin.inventory.toastFailed');
    }
  }

  async function handleTransferSubmit() {
    const items: TransferItemInput[] = transferRows
      .filter((r) => r.skuId && r.quantity)
      .map((r) => ({ skuId: r.skuId, quantity: Number(r.quantity) }))
      .filter((r) => Number.isInteger(r.quantity) && r.quantity > 0);
    if (items.length === 0 || !transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
      toast({ title: t('admin.inventory.toastFailed'), description: t('admin.inventory.noValidRows'), variant: 'destructive' });
      return;
    }
    try {
      await transferMutation.mutateAsync({
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        items,
      });
      toast({ title: t('admin.inventory.toastTransferSuccess') });
      setTransferOpen(false);
      setTransferForm({ fromWarehouseId: '', toWarehouseId: '' });
      setTransferRows([{ skuId: '', quantity: '' }]);
    } catch (err) {
      toastError(err, 'admin.inventory.toastFailed');
    }
  }

  async function handleImportSubmit() {
    if (!importFile) return;
    try {
      const result = await importMutation.mutateAsync(importFile);
      setImportResult(result.data);
      toast({ title: t('admin.inventory.toastImportSuccess', { count: result.data.successCount }) });
    } catch (err) {
      toastError(err, 'admin.inventory.toastFailed');
    }
  }

  async function handleExport() {
    try {
      await exportStocksCsv(warehouseId || undefined);
      toast({ title: t('admin.inventory.toastExportSuccess') });
    } catch (err) {
      toastError(err, 'admin.inventory.toastFailed');
    }
  }

  const stockColumns: Column<Stock>[] = [
    { key: 'warehouseId', header: t('admin.inventory.columnWarehouse'), render: (row) => <span className="font-mono text-xs">{row.warehouseId}</span> },
    { key: 'skuId', header: t('admin.inventory.columnSku'), render: (row) => <span className="font-mono text-xs">{row.skuId}</span> },
    { key: 'quantity', header: t('admin.inventory.columnQuantity'), render: (row) => <span className="font-mono text-sm">{row.quantity}</span> },
    { key: 'safetyStock', header: t('admin.inventory.columnSafetyStock'), render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.safetyStock ?? 0}</span> },
    {
      key: 'status',
      header: t('admin.inventory.columnStatus'),
      render: (row) => {
        const low = row.quantity <= (row.safetyStock ?? 0);
        return (
          <span className={`text-xs ${low ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
            {low ? t('admin.inventory.statusLow') : t('admin.inventory.statusOk')}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.inventory.title')}
        description={t('admin.inventory.description')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBatchOpen(true)}>{t('admin.inventory.batchAdjustButton')}</Button>
            <Button variant="outline" onClick={() => setTransferOpen(true)}>{t('admin.inventory.transferButton')}</Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>{t('admin.inventory.importButton')}</Button>
            <Button variant="outline" onClick={handleExport} disabled={stocksQuery.isPending}>{t('admin.inventory.exportButton')}</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('admin.inventory.searchWarehousePlaceholder')}
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="w-56"
        />
        <Button variant={lowStockOnly ? 'default' : 'outline'} onClick={() => setLowStockOnly((v) => !v)}>
          {t('admin.inventory.lowStockButton')}
        </Button>
      </div>

      {stocksQuery.error ? (
        <ErrorState onRetry={() => stocksQuery.refetch()} />
      ) : stocksQuery.isPending ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : stocks.length === 0 ? (
        <EmptyState title={t('admin.inventory.empty')} description={t('admin.inventory.emptyDescription')} />
      ) : (
        <DataTable data={stocks} columns={stockColumns} />
      )}

      {/* 调拨记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('admin.inventory.transfersTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {transfersQuery.isPending ? (
            <div className="text-xs text-muted-foreground">{t('loading')}</div>
          ) : transfers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('admin.inventory.transfersEmpty')}</p>
          ) : (
            <div className="space-y-2">
              {transfers.map((tr) => (
                <div key={tr.referenceId} className="border-b pb-2 text-xs last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">{tr.referenceId.slice(0, 8)}</span>
                    <span>{tr.fromWarehouseId.slice(0, 8)} → {tr.toWarehouseId.slice(0, 8)}</span>
                    <span className="text-muted-foreground">{new Date(tr.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {tr.items.map((it, i) => (
                      <span key={i} className="mr-3">{it.skuId.slice(0, 8)} ×{it.quantity}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 批量调整 Dialog */}
      <Dialog open={batchOpen} onOpenChange={(open) => !open && setBatchOpen(false)}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>{t('admin.inventory.batchDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.inventory.batchDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {batchRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_100px_1fr_auto] gap-2">
                <Input placeholder="warehouseId" value={row.warehouseId} onChange={(e) => setBatchRows((rs) => rs.map((r, j) => j === i ? { ...r, warehouseId: e.target.value } : r))} />
                <Input placeholder="skuId" value={row.skuId} onChange={(e) => setBatchRows((rs) => rs.map((r, j) => j === i ? { ...r, skuId: e.target.value } : r))} />
                <Input placeholder="deltaQty" type="number" value={row.deltaQty} onChange={(e) => setBatchRows((rs) => rs.map((r, j) => j === i ? { ...r, deltaQty: e.target.value } : r))} />
                <Input placeholder="reason" value={row.reason} onChange={(e) => setBatchRows((rs) => rs.map((r, j) => j === i ? { ...r, reason: e.target.value } : r))} />
                <Button size="icon" variant="ghost" onClick={() => setBatchRows((rs) => rs.filter((_, j) => j !== i))} disabled={batchRows.length === 1}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setBatchRows((rs) => [...rs, { warehouseId: '', skuId: '', deltaQty: '', reason: '' }])}>
              <Plus className="h-4 w-4" /> {t('admin.inventory.addRow')}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>{t('admin.inventory.commonCancel')}</Button>
            <Button onClick={handleBatchSubmit} disabled={batchMutation.isPending}>
              {batchMutation.isPending ? t('loading') : t('admin.inventory.batchSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调拨 Dialog */}
      <Dialog open={transferOpen} onOpenChange={(open) => !open && setTransferOpen(false)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t('admin.inventory.transferDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.inventory.transferDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('admin.inventory.fromWarehouse')}</Label>
                <Input placeholder="warehouseId" value={transferForm.fromWarehouseId} onChange={(e) => setTransferForm((f) => ({ ...f, fromWarehouseId: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('admin.inventory.toWarehouse')}</Label>
                <Input placeholder="warehouseId" value={transferForm.toWarehouseId} onChange={(e) => setTransferForm((f) => ({ ...f, toWarehouseId: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t('admin.inventory.itemsLabel')}</Label>
              {transferRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2">
                  <Input placeholder="skuId" value={row.skuId} onChange={(e) => setTransferRows((rs) => rs.map((r, j) => j === i ? { ...r, skuId: e.target.value } : r))} />
                  <Input placeholder="quantity" type="number" value={row.quantity} onChange={(e) => setTransferRows((rs) => rs.map((r, j) => j === i ? { ...r, quantity: e.target.value } : r))} />
                  <Button size="icon" variant="ghost" onClick={() => setTransferRows((rs) => rs.filter((_, j) => j !== i))} disabled={transferRows.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setTransferRows((rs) => [...rs, { skuId: '', quantity: '' }])}>
                <Plus className="h-4 w-4" /> {t('admin.inventory.addRow')}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t('admin.inventory.commonCancel')}</Button>
            <Button onClick={handleTransferSubmit} disabled={transferMutation.isPending}>
              {transferMutation.isPending ? t('loading') : t('admin.inventory.transferSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV 导入 Dialog */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) { setImportOpen(false); setImportFile(null); setImportResult(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.inventory.importDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.inventory.importDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input type="file" accept=".csv" onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null); }} />
            {importResult && (
              <div className="space-y-2 rounded border p-3 text-xs">
                <div>{t('admin.inventory.importSuccessCount', { count: importResult.successCount })}</div>
                {importResult.failedRows.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs font-bold text-destructive">{t('admin.inventory.importFailedRows')}</Label>
                    {importResult.failedRows.map((f, i) => (
                      <div key={i} className="font-mono text-destructive">row {f.row}: {f.error}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportFile(null); setImportResult(null); }}>{t('admin.inventory.commonCancel')}</Button>
            <Button onClick={handleImportSubmit} disabled={!importFile || importMutation.isPending}>
              {importMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</> : t('admin.inventory.importSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
