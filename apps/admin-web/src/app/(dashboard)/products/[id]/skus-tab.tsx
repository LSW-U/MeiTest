/**
 * 商品详情 · SKU tab（批C 从 page.tsx 拆出，逻辑不变）
 *
 * 后端：GET/POST /admin/products/:id/skus
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import {
  useProductSkus,
  useCreateSku,
  type I18nText,
  type Sku,
} from '@/hooks/api/use-products';
import { formatCurrency } from '@/lib/utils';

export function SkusTab({ productId }: { productId: string }) {
  const t = useTranslations('common');
  const skusQ = useProductSkus(productId);
  const createSkuMutation = useCreateSku();

  const skuColumns: Column<Sku>[] = [
    {
      key: 'name',
      header: t('w.products.columnSkuName'),
      render: (row) => <span className="font-medium">{row.name?.en ?? '—'}</span>,
    },
    {
      key: 'attributes',
      header: t('w.products.columnAttributes'),
      render: (row) =>
        row.attributes ? (
          <code className="text-xs">
            {Object.entries(row.attributes)
              .map(([k, v]) => `${k}=${v}`)
              .join(' / ')}
          </code>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'price',
      header: t('w.products.columnPrice'),
      render: (row) => (
        <span className="font-mono text-xs">{formatCurrency(row.price)}</span>
      ),
    },
    {
      key: 'status',
      header: t('w.form.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.products.skuListTitle')}</CardTitle>
        <CreateSkuDialog
          productId={productId}
          onCreate={(input) => createSkuMutation.mutate({ productId, input })}
          pending={createSkuMutation.isPending}
        />
      </CardHeader>
      <CardContent>
        <DataTable
          data={skusQ.data?.data ?? []}
          columns={skuColumns}
          isLoading={skusQ.isLoading}
          errorState={
            skusQ.error ? (
              <ErrorState message={skusQ.error.message} onRetry={() => skusQ.refetch()} />
            ) : null
          }
        />
      </CardContent>
    </Card>
  );
}

/** 新建 SKU 弹窗（从原 page.tsx 原样迁入：price 输入美元 → 落库转分） */
function CreateSkuDialog({
  productId,
  onCreate,
  pending,
}: {
  productId: string;
  onCreate: (input: {
    name: I18nText;
    price: number;
    attributes?: Record<string, string>;
  }) => void;
  pending: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [price, setPrice] = useState('');
  const [attrKey, setAttrKey] = useState('');
  const [attrVal, setAttrVal] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents)) return;
    onCreate({
      name: { en: nameEn },
      price: priceCents,
      attributes: attrKey ? { [attrKey]: attrVal } : undefined,
    });
    setOpen(false);
    setNameEn('');
    setPrice('');
    setAttrKey('');
    setAttrVal('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('w.products.newSku')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('w.products.createSkuFor', { productId })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>{t('w.products.nameEnLabel')}</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>{t('w.products.priceUsd')}</Label>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>{t('w.products.attributeKey')}</Label>
              <Input
                value={attrKey}
                onChange={(e) => setAttrKey(e.target.value)}
                placeholder={t('w.products.attrKeyPlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('w.products.attributeValue')}</Label>
              <Input
                value={attrVal}
                onChange={(e) => setAttrVal(e.target.value)}
                placeholder={t('w.products.attrValPlaceholder')}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('w.form.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('w.form.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
