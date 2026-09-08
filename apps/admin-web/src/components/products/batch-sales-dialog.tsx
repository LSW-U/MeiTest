/**
 * BatchSalesDialog — 销量批量调整弹窗（批C）
 *
 * 后端：PATCH /admin/products/sales-batch（设值语义，delta 推导写 SalesCountLog ADMIN_ADJUST）
 *
 * 纪律：mutateAsync + await + try/catch（失败弹 toast 不静默），成功后 onDone 由父页清空选择
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  useAdjustSalesCountBatch,
  type Product,
  type SalesBatchAdjustResult,
} from '@/hooks/api/use-products';

export function BatchSalesDialog({
  open,
  onOpenChange,
  selected,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 勾选中的商品（含名称展示 + id 提交） */
  selected: Product[];
  /** 成功后回调（父页清空选择并关闭） */
  onDone: () => void;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const adjustMutation = useAdjustSalesCountBatch();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  /** 提交：输入校验（非负整数）→ 设值批量请求 */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const target = Number(value);
    if (!Number.isInteger(target) || target < 0) {
      setError(t('w.products.batchAdjustInvalid'));
      return;
    }
    try {
      const res = await adjustMutation.mutateAsync(
        selected.map((p) => ({ id: p.id, salesCount: target })),
      );
      const result: SalesBatchAdjustResult = res.data;
      toast({
        title: t('w.products.batchAdjustSuccess', { count: result.adjusted.length }),
        description:
          result.skipped.length > 0
            ? t('w.products.batchAdjustSkipped', { count: result.skipped.length })
            : undefined,
      });
      setValue('');
      onDone();
    } catch (err) {
      toast({
        title: t('w.products.batchAdjustFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.products.batchAdjustTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('w.products.batchAdjustDesc', { count: selected.length })}
          </p>
          {/* 选中名单（截前 5 个防溢出，其余以数量表达） */}
          <ul className="space-y-1 rounded border p-2 text-xs text-muted-foreground">
            {selected.slice(0, 5).map((p) => (
              <li key={p.id} className="truncate">
                • {p.name?.en ?? p.id}
              </li>
            ))}
            {selected.length > 5 && (
              <li>{t('w.products.batchAdjustMore', { count: selected.length - 5 })}</li>
            )}
          </ul>
          <div className="space-y-1">
            <Label htmlFor="batch-sales-target">{t('w.products.targetSalesCount')}</Label>
            <Input
              id="batch-sales-target"
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{t('w.products.batchAdjustHint')}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('w.form.cancel')}
            </Button>
            <Button type="submit" disabled={adjustMutation.isPending}>
              {adjustMutation.isPending
                ? t('w.form.adjusting')
                : t('w.products.batchAdjustConfirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
