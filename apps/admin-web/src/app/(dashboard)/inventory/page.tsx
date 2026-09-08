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

import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
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
import { Download, Loader2, Plus, Trash2 } from 'lucide-react';
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
import { ImportHistoryCard } from '@/components/import/import-history-card';
import { ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface BatchRow {
  warehouseId: string;
  skuId: string;
  deltaQty: string;
  reason: string;
}

// ============================================================================
// 批E：CSV 导入预览（papaparse 本地解析）+ 失败明细下载 + 导入历史
//
// 预览校验对齐后端行为（inventory.service.importStocksCsv，R4）：
//   表头 warehouseId,skuId,deltaQty（reason 可选）/ 1000 行上限 /
//   warehouseId、skuId 强制 uuid（不是 W01 这种 code）/ deltaQty 整数且非 0
// 预览 ≠ 后端手写 split 的最终结果——结果页如实展示 failedRows
// ============================================================================

/** 预览展示的数据行数（表头之外的前 8 行） */
const IMPORT_PREVIEW_ROWS = 8;
/** 与后端 MAX_IMPORT_ROWS 一致（超出后端直接 400 E-INVENTORY-009） */
const IMPORT_MAX_ROWS = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ImportPreview {
  headers: string[];
  /** 预览数据行（不含表头，前 IMPORT_PREVIEW_ROWS 行） */
  rows: string[][];
  totalDataRows: number;
  /** 表头缺 warehouseId/skuId/deltaQty 必填列 */
  headerError: boolean;
  /** 首个错误行（row 为含表头的 1-based 行号，对齐后端 failedRows.row） */
  firstError: { row: number; error: string } | null;
}

/** 单行校验（错误文案与后端 failedRows.error 同款，保持一致便于对照） */
function validateImportRow(
  cols: string[],
  idxWh: number,
  idxSku: number,
  idxDelta: number,
): string | null {
  const warehouseId = cols[idxWh];
  const skuId = cols[idxSku];
  const deltaQtyStr = cols[idxDelta];
  if (!warehouseId || !skuId || !deltaQtyStr) {
    return 'missing required field (warehouseId/skuId/deltaQty)';
  }
  if (!UUID_RE.test(warehouseId)) {
    return `warehouseId not uuid: ${warehouseId}`;
  }
  if (!UUID_RE.test(skuId)) {
    return `skuId not uuid: ${skuId}`;
  }
  const deltaQty = Number(deltaQtyStr);
  if (!Number.isInteger(deltaQty)) {
    return `deltaQty not integer: ${deltaQtyStr}`;
  }
  if (deltaQty === 0) {
    return 'deltaQty cannot be 0';
  }
  return null;
}

/** 失败明细下载 CSV（row,error 两列；BOM 前缀保 Excel 打开不乱码；文件名含日期） */
function downloadFailedRowsCsv(failedRows: Array<{ row: number; error: string }>): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['row,error', ...failedRows.map((f) => `${f.row},${esc(f.error)}`)];
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-failed-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

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

  /** 选文件后 papaparse 本地解析预览（不提交，校验对齐后端 R4 行为） */
  function handleImportFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setImportResult(null);
    setImportPreview(null);
    if (!file) return;
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const all = results.data.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
        const header = all[0] ?? [];
        const lowerHeader = header.map((h) => (h ?? '').trim().toLowerCase());
        const idxWh = lowerHeader.indexOf('warehouseid');
        const idxSku = lowerHeader.indexOf('skuid');
        const idxDelta = lowerHeader.indexOf('deltaqty');
        const headerError = idxWh < 0 || idxSku < 0 || idxDelta < 0;
        const dataRows = all.slice(1);
        let firstError: ImportPreview['firstError'] = null;
        if (!headerError) {
          for (let i = 0; i < dataRows.length; i++) {
            const err = validateImportRow(dataRows[i]!, idxWh, idxSku, idxDelta);
            if (err) {
              // 行号含表头（1-based），对齐后端 failedRows.row 语义
              firstError = { row: i + 2, error: err };
              break;
            }
          }
        }
        setImportPreview({
          headers: header,
          rows: dataRows.slice(0, IMPORT_PREVIEW_ROWS),
          totalDataRows: dataRows.length,
          headerError,
          firstError,
        });
      },
    });
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

      {/* 导入历史（批E D5 v2 → 批F 提取共用组件 ImportHistoryCard，resourceType=Stock） */}
      <ImportHistoryCard resourceType="Stock" />

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

      {/* CSV 导入 Dialog（批E：选文件 → papaparse 本地预览 → 确认提交 → 结果 + 失败明细下载） */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) { setImportOpen(false); setImportFile(null); setImportResult(null); setImportPreview(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.inventory.importDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.inventory.importDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input type="file" accept=".csv" onChange={handleImportFileChange} />

            {/* 预览区（D6：前端本地解析，展示前 8 行 + 表头校验 + 首个错误行提示） */}
            {importPreview && (
              <div className="space-y-2 rounded border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{t('admin.inventory.importPreviewTitle')}</span>
                  <span className="text-muted-foreground">
                    {t('admin.inventory.importPreviewRowsTotal', { count: importPreview.totalDataRows })}
                  </span>
                </div>
                {importPreview.headerError ? (
                  <div className="font-bold text-destructive">{t('admin.inventory.importPreviewHeaderError')}</div>
                ) : (
                  <>
                    {importPreview.totalDataRows > IMPORT_MAX_ROWS && (
                      <div className="font-bold text-destructive">
                        {t('admin.inventory.importPreviewOverLimit', { max: IMPORT_MAX_ROWS })}
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] border-collapse">
                        <thead>
                          <tr className="bg-muted/50">
                            {importPreview.headers.map((h, i) => (
                              <th key={i} className="border px-2 py-1 text-left font-mono font-bold">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.rows.map((row, i) => (
                            <tr key={i}>
                              {importPreview.headers.map((_, j) => (
                                <td key={j} className="border px-2 py-1 font-mono">{row[j] ?? ''}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {importPreview.firstError && (
                      <div className="text-destructive">
                        {t('admin.inventory.importPreviewRowError', {
                          row: importPreview.firstError.row,
                          error: importPreview.firstError.error,
                        })}
                      </div>
                    )}
                  </>
                )}
                <div className="text-muted-foreground">{t('admin.inventory.importPreviewHint')}</div>
              </div>
            )}

            {importResult && (
              <div className="space-y-2 rounded border p-3 text-xs">
                <div>{t('admin.inventory.importSuccessCount', { count: importResult.successCount })}</div>
                {importResult.failedRows.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold text-destructive">{t('admin.inventory.importFailedRows')}</Label>
                      {/* 批E 真增量：失败明细下载 CSV（row/error 两列，文件名含日期） */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFailedRowsCsv(importResult.failedRows)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('admin.inventory.importDownloadFailed')}
                      </Button>
                    </div>
                    {importResult.failedRows.map((f, i) => (
                      <div key={i} className="font-mono text-destructive">row {f.row}: {f.error}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportFile(null); setImportResult(null); setImportPreview(null); }}>{t('admin.inventory.commonCancel')}</Button>
            <Button
              onClick={handleImportSubmit}
              disabled={
                !importFile ||
                !!importPreview?.headerError ||
                (importPreview?.totalDataRows ?? 0) > IMPORT_MAX_ROWS ||
                importMutation.isPending
              }
            >
              {importMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</> : t('admin.inventory.importSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
