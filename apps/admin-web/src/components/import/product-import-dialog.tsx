/**
 * ProductImportDialog — 商品批量导入 Dialog（批F 2026-09-07）
 *
 * 后端：POST /admin/products/import（multipart，全错全不写 D12）
 *   - 校验/判重任一行错 → 400 E-PRODUCT-IMPORT-001 + error.details.failedRows[{line,field,reason}]
 *   - 全通过 → 单事务写入 → 成功响应含 skippedRows/overwrittenRows/createdProducts
 *
 * 交互链路（对齐批E 库存导入模式）：
 *   选文件 → papaparse 本地预览（前 8 行 + 行数上限提示，不做深度行校验——预览 ≠ 后端最终校验）
 *   → 选重复策略（D8 三模式）→ 提交 → 结果区（成功/跳过/覆盖明细 + 400 失败明细下载）
 */
'use client';

import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import Papa from 'papaparse';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Loader2 } from 'lucide-react';
import {
  useImportProductsCsv,
  type ImportMode,
  type ProductImportResultData,
} from '@/hooks/api/use-products';
import { ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

/** 预览展示的数据行数（表头之外的前 8 行，对齐批E 库存导入） */
const PREVIEW_ROWS = 8;
/** 与后端 MAX_IMPORT_ROWS 一致（超出后端直接 400） */
const MAX_ROWS = 1000;

interface Preview {
  headers: string[];
  rows: string[][];
  totalDataRows: number;
}

/** CSV 模板（BOM 前缀保 Excel 不乱码；表头 + 2 示例行：全字段 / 最小字段）
 *  遵守商品导入约束：name 简短商品名、各语言独立填值（没翻译留空 fallback en）、
 *  price 单位元两位小数（后端转分）、tet 列留空。 */
function downloadTemplateCsv(): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header =
    'name_en,name_zh,name_tet,price,category,stock,skuCode,warehouseCode,mainImage,unit_en,unit_zh,unit_tet,desc_en,desc_zh,desc_tet';
  const row1 = [
    'Milk', '牛奶', '', '3.50', 'Dairy', '50', 'SKU-MILK-001', 'W01',
    'https://example.com/milk.png', 'pack', '包', 'pak',
    'Pasteurized whole milk 1L', '巴氏杀菌全脂牛奶 1L', '',
  ].map(esc).join(',');
  const row2 = [
    'Apple', '苹果', '', '1.20', 'Fruit', '30', '', '',
    'https://example.com/apple.png', 'kg', '千克', 'kg',
    'Fresh red apple', '新鲜红苹果', '',
  ].map(esc).join(',');
  const blob = new Blob([String.fromCharCode(0xfeff) + [header, row1, row2].join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'product-import-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 400 失败明细下载 CSV（line,field,reason 三列；文件名含日期） */
function downloadFailedRowsCsv(
  failedRows: Array<{ line: number; field: string; reason: string }>,
): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['line,field,reason', ...failedRows.map((f) => `${f.line},${esc(f.field)},${esc(f.reason)}`)];
  const blob = new Blob([String.fromCharCode(0xfeff) + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `product-import-failed-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 从 400 ApiError 提取 details.failedRows（后端全错全不写响应） */
function extractFailedRows(err: unknown): Array<{ line: number; field: string; reason: string }> {
  if (err instanceof ApiError && err.details && typeof err.details === 'object') {
    const rows = (err.details as { failedRows?: unknown }).failedRows;
    if (Array.isArray(rows)) return rows as Array<{ line: number; field: string; reason: string }>;
  }
  return [];
}

export function ProductImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [mode, setMode] = useState<ImportMode>('skip');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ProductImportResultData | null>(null);
  const [failedRows, setFailedRows] = useState<Array<{ line: number; field: string; reason: string }>>([]);

  const importMutation = useImportProductsCsv(mode);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setFailedRows([]);
  }

  /** 选文件后 papaparse 本地解析预览（仅展示性校验，最终以后端 400 failedRows 为准） */
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    reset();
    setFile(f);
    if (!f) return;
    Papa.parse<string[]>(f, {
      skipEmptyLines: 'greedy',
      complete: (results) => {
        const all = results.data.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
        setPreview({
          headers: all[0] ?? [],
          rows: all.slice(1, PREVIEW_ROWS + 1),
          totalDataRows: Math.max(0, all.length - 1),
        });
      },
    });
  }

  async function handleSubmit() {
    if (!file) return;
    setFailedRows([]);
    try {
      const res = await importMutation.mutateAsync(file);
      setResult(res.data);
      toast({ title: t('w.products.importToastSuccess', { count: res.data.successCount }) });
    } catch (err) {
      // 全错全不写（D12）：400 明细落在 ApiError.details.failedRows，展示 + 可下载
      setResult(null); // 清旧成功结果（mode 切换重提场景）
      const rows = extractFailedRows(err);
      setFailedRows(rows);
      toast({ title: t('w.products.importToastFailed'), variant: 'destructive' });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{t('w.products.importDialogTitle')}</DialogTitle>
          <DialogDescription>{t('w.products.importDialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 模板下载 + 文件选择 */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplateCsv}>
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('w.products.importTemplateButton')}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('w.products.importFileLabel')}</Label>
            <Input type="file" accept=".csv" onChange={handleFileChange} />
          </div>

          {/* 重复策略（D8 三模式，默认 skip）——key 用字面量供 i18n 守卫脚本扫描 */}
          <div className="space-y-1">
            <Label className="text-xs">{t('w.products.importModeLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'skip' ? 'default' : 'outline'}
                onClick={() => setMode('skip')}
              >
                {t('w.products.importMode_skip')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'overwrite' ? 'default' : 'outline'}
                onClick={() => setMode('overwrite')}
              >
                {t('w.products.importMode_overwrite')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'error' ? 'default' : 'outline'}
                onClick={() => setMode('error')}
              >
                {t('w.products.importMode_error')}
              </Button>
            </div>
            {mode === 'skip' && (
              <p className="text-xs text-muted-foreground">{t('w.products.importModeHint_skip')}</p>
            )}
            {mode === 'overwrite' && (
              <p className="text-xs text-muted-foreground">{t('w.products.importModeHint_overwrite')}</p>
            )}
            {mode === 'error' && (
              <p className="text-xs text-muted-foreground">{t('w.products.importModeHint_error')}</p>
            )}
          </div>

          {/* 预览区（前 8 行 + 行数上限提示；不做深度行校验，最终以后端为准） */}
          {preview && (
            <div className="space-y-2 rounded border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold">{t('w.products.importPreviewTitle')}</span>
                <span className="text-muted-foreground">
                  {t('w.products.importPreviewRowsTotal', { count: preview.totalDataRows })}
                </span>
              </div>
              {preview.totalDataRows > MAX_ROWS && (
                <div className="font-bold text-destructive">
                  {t('w.products.importPreviewOverLimit', { max: MAX_ROWS })}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      {preview.headers.map((h, i) => (
                        <th key={i} className="border px-2 py-1 text-left font-mono font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {preview.headers.map((_, j) => (
                          <td key={j} className="border px-2 py-1 font-mono">{row[j] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 成功结果区：成功/跳过/覆盖/新建明细 */}
          {result && (
            <div className="space-y-2 rounded border p-3 text-xs">
              <div className="font-bold text-green-600">
                {t('w.products.importSuccessCount', { count: result.successCount })}
              </div>
              {result.skippedRows.length > 0 && (
                <div>
                  <div className="font-bold">{t('w.products.importSkippedRows', { count: result.skippedRows.length })}</div>
                  {result.skippedRows.map((s, i) => (
                    <div key={i} className="font-mono text-muted-foreground">
                      line {s.line}: {s.key}
                    </div>
                  ))}
                </div>
              )}
              {result.overwrittenRows.length > 0 && (
                <div>
                  <div className="font-bold">{t('w.products.importOverwrittenRows', { count: result.overwrittenRows.length })}</div>
                  {result.overwrittenRows.map((s, i) => (
                    <div key={i} className="font-mono text-muted-foreground">
                      line {s.line}: {s.key}
                    </div>
                  ))}
                </div>
              )}
              {result.createdProducts.length > 0 && (
                <div>
                  <div className="font-bold">{t('w.products.importCreatedList')}</div>
                  <div className="max-h-24 space-y-0.5 overflow-y-auto">
                    {result.createdProducts.map((p) => (
                      <div key={p.id} className="font-mono text-muted-foreground truncate">
                        {p.name}{p.skuCode ? ` · ${p.skuCode}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 400 失败明细区（全错全不写：任何行错 → 0 写入） */}
          {failedRows.length > 0 && (
            <div className="space-y-1 rounded border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-destructive">
                  {t('w.products.importFailedRows', { count: failedRows.length })}
                </span>
                <Button variant="outline" size="sm" onClick={() => downloadFailedRowsCsv(failedRows)}>
                  <Download className="h-3.5 w-3.5" />
                  {t('w.products.importDownloadFailed')}
                </Button>
              </div>
              <div className="max-h-32 space-y-0.5 overflow-y-auto">
                {failedRows.map((f, i) => (
                  <div key={i} className="font-mono text-destructive">
                    line {f.line} [{f.field}]: {f.reason}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!file || (preview?.totalDataRows ?? 0) > MAX_ROWS || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</>
            ) : (
              t('w.products.importSubmit')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
