/**
 * 登记缺货 Dialog（缺货履约闭环批1 2026-10-24）
 *
 * 项选择 + 数量 + 原因 + 备注 + 替代建议（可空）+ 取证照片（≤3，复用 uploadByScene）。
 * 端点：POST /admin/orders/:id/items/:itemId/out-of-stock（窗口 CONFIRMED/PICKED）。
 *
 * 取证上传场景：P2-3（审查 20261024）新增独立 oos-evidence 端点（最小 300×200 任意比例，
 * 保留 magic bytes 校验），upload-scenes.ts 已注册场景，本 dialog 挂 'oos-evidence'。
 * 后端 evidenceUrls 侧有 isOwnUrl 域校验（E-OOS-005），语义一致。
 */
'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { uploadByScene } from '@/lib/upload-scenes';
import { ApiError } from '@/lib/api';
import { useReportOutOfStock, type OrderItem } from '@/hooks/api/use-orders';
import type { I18nText } from '@/hooks/api/use-products';

const OOS_REASONS = ['DAMAGED', 'EXPIRED', 'MISSING', 'MISLABELED', 'OTHER'] as const;
const MAX_EVIDENCE_URLS = 3;

/** 多语言字段取值（fallback 链，与 page.tsx displayName 一致） */
function displayName(value: I18nText | unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, string>;
    return record.zh ?? record.en ?? record.id ?? record.pt ?? Object.values(record)[0] ?? '';
  }
  return '';
}

interface OutOfStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  items: OrderItem[];
  /** 登记成功回调（toast 已在内部处理，这里用于 refetch） */
  onReported: (orderCancelled: boolean) => void;
}

export function OutOfStockDialog({
  open,
  onOpenChange,
  orderId,
  items,
  onReported,
}: OutOfStockDialogProps) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const mutation = useReportOutOfStock();

  const [itemId, setItemId] = useState<string>('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<string>('DAMAGED');
  const [note, setNote] = useState('');
  const [suggestionItemId, setSuggestionItemId] = useState<string>('none');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedItem = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const suggestionCandidates = useMemo(
    () => items.filter((i) => i.id !== itemId),
    [items, itemId],
  );

  function resetForm() {
    setItemId('');
    setQty('1');
    setReason('DAMAGED');
    setNote('');
    setSuggestionItemId('none');
    setEvidenceUrls([]);
  }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许重选同一文件
    const remain = MAX_EVIDENCE_URLS - evidenceUrls.length;
    if (remain <= 0) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files.slice(0, remain)) {
        const res = await uploadByScene('oos-evidence', file); // P2-3：切独立取证场景（任意比例）
        uploaded.push(res.data.url);
      }
      setEvidenceUrls((prev) => [...prev, ...uploaded].slice(0, MAX_EVIDENCE_URLS));
    } catch (err) {
      toast({
        title: err instanceof ApiError ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    if (!selectedItem) return;
    mutation.mutate(
      {
        orderId,
        itemId: selectedItem.id,
        input: {
          outOfStockQty: Number(qty),
          reason,
          note: note.trim() ? note.trim() : null,
          evidenceUrls: evidenceUrls.length > 0 ? evidenceUrls : undefined,
          suggestionItemId: suggestionItemId !== 'none' ? suggestionItemId : undefined,
        },
      },
      {
        onSuccess: (result) => {
          toast({
            title: result.orderCancelled
              ? t('admin.orders.oosToastCancelled')
              : t('admin.orders.oosToastReported'),
          });
          onOpenChange(false);
          resetForm();
          onReported(result.orderCancelled);
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : String(err);
          toast({ title: message, variant: 'destructive' });
        },
      },
    );
  }

  const qtyNum = Number(qty);
  const canSubmit =
    !!selectedItem &&
    Number.isInteger(qtyNum) &&
    qtyNum >= 1 &&
    qtyNum <= (selectedItem.quantity ?? 1) &&
    !mutation.isPending &&
    !uploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.orders.oosDialogTitle')}</DialogTitle>
          <DialogDescription>{t('admin.orders.oosDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="oos-item">{t('admin.orders.oosItemLabel')}</Label>
            <Select value={itemId} onValueChange={(v) => { setItemId(v); setSuggestionItemId('none'); }}>
              <SelectTrigger id="oos-item">
                <SelectValue placeholder={t('admin.orders.oosItemLabel')} />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={item.outOfStockQty != null}>
                    {displayName(item.productName)}
                    {item.outOfStockQty != null ? ` (${t('admin.orders.oosReportedTag')})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oos-qty">{t('admin.orders.oosQtyLabel')}</Label>
            <Input
              id="oos-qty"
              type="number"
              min={1}
              max={selectedItem?.quantity ?? undefined}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('admin.orders.oosReasonLabel')}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OOS_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`admin.orders.oosReason${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oos-note">{t('admin.orders.oosNoteLabel')}</Label>
            <Textarea
              id="oos-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('admin.orders.oosEvidenceLabel')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFilesChange}
              disabled={uploading || evidenceUrls.length >= MAX_EVIDENCE_URLS}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || evidenceUrls.length >= MAX_EVIDENCE_URLS}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? t('admin.orders.oosSubmitting') : t('admin.orders.oosAddEvidence')}
            </Button>
            {evidenceUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {evidenceUrls.map((url, i) => (
                  <div key={url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`evidence-${i}`} className="h-16 w-16 rounded border object-cover" />
                    <button
                      type="button"
                      aria-label={`remove-${i}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
                      onClick={() => setEvidenceUrls((prev) => prev.filter((u) => u !== url))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('admin.orders.oosSuggestionLabel')}</Label>
            <Select value={suggestionItemId} onValueChange={setSuggestionItemId} disabled={!selectedItem}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-</SelectItem>
                {suggestionCandidates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {displayName(item.productName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? t('admin.orders.oosSubmitting') : t('admin.orders.oosSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
