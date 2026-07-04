/**
 * 商品详情/编辑页 — /products/[id]
 *
 * 后端：
 *   - GET/PATCH /admin/products/:id
 *   - PATCH /admin/products/:id/status
 *   - GET/POST /admin/products/:id/skus
 */
'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useProduct,
  useUpdateProduct,
  useUpdateProductStatus,
  useProductSkus,
  useCreateSku,
  type I18nText,
  type Sku,
} from '@/hooks/api/use-products';
import { apiUploadFile, type ApiSuccess } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type Locale = 'en' | 'zh' | 'id' | 'pt';

interface UploadResponse {
  url: string;
  key: string;
  size: number;
}

export default function ProductDetailPage() {
  const t = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const productQ = useProduct(id);
  const updateMutation = useUpdateProduct();
  const statusMutation = useUpdateProductStatus();
  const skusQ = useProductSkus(id);
  const createSkuMutation = useCreateSku();

  const [name, setName] = useState<I18nText>({});
  const [mainImage, setMainImage] = useState('');
  const [description, setDescription] = useState<I18nText>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (productQ.data?.data) {
      setName(productQ.data.data.name ?? {});
      setMainImage(productQ.data.data.mainImage ?? '');
      setDescription(productQ.data.data.description ?? {});
    }
  }, [productQ.data]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const res = await apiUploadFile<ApiSuccess<UploadResponse>>(
        '/admin/uploads/product-image',
        file,
      );
      setMainImage(res.data.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (productQ.isLoading) return <LoadingSkeleton lines={8} />;
  if (productQ.error)
    return (
      <ErrorState message={productQ.error.message} onRetry={() => productQ.refetch()} />
    );
  if (!productQ.data?.data) return null;

  const product = productQ.data.data;

  const handleSaveBasic = async () => {
    await updateMutation.mutateAsync({
      id,
      input: { name, mainImage: mainImage || undefined, description },
    });
  };

  const i18nInputs = (
    label: string,
    value: I18nText,
    onChange: (v: I18nText) => void,
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {(['en', 'zh', 'id', 'pt'] as Locale[]).map((locale) => (
          <div key={locale} className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">{locale}</Label>
            <Input
              value={value[locale] ?? ''}
              onChange={(e) => onChange({ ...value, [locale]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );

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
    <>
      <PageHeader
        title={product.name?.en ?? product.id}
        breadcrumb={[
          { label: t('w.products.title'), href: '/products' },
          { label: product.name?.en ?? product.id },
        ]}
        action={
          <Button
            variant={product.status === 'ACTIVE' ? 'destructive' : 'default'}
            disabled={product.status === 'OUT_OF_STOCK' || statusMutation.isPending}
            onClick={() =>
              statusMutation.mutate({
                id,
                status: product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
              })
            }
          >
            {product.status === 'ACTIVE'
              ? t('w.status.toggle_off')
              : t('w.status.toggle_on')}
          </Button>
        }
      />

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">{t('w.form.basicInfo')}</TabsTrigger>
          <TabsTrigger value="skus">{t('w.products.skuListTitle')}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('w.products.editProductTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {i18nInputs(t('w.form.name'), name, setName)}
              <div className="space-y-2">
                <Label>{t('w.form.mainImageUpload')}</Label>
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="text-sm"
                  />
                  {mainImage && (
                    <img
                      src={mainImage}
                      alt=""
                      className="h-20 w-20 rounded border object-cover"
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('w.form.mainImageHint')}</p>
                {uploading && (
                  <p className="text-xs text-muted-foreground">{t('w.form.uploading')}</p>
                )}
                {uploadError && (
                  <p className="text-xs text-destructive">
                    {t('w.form.uploadFailed')}: {uploadError}
                  </p>
                )}
                {mainImage && (
                  <Input
                    value={mainImage}
                    onChange={(e) => setMainImage(e.target.value)}
                    className="font-mono text-xs"
                  />
                )}
              </div>
              {i18nInputs(t('w.form.description'), description, setDescription)}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/products')}
                >
                  {t('w.form.back')}
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveBasic}
                  disabled={updateMutation.isPending || uploading}
                >
                  {uploading
                    ? t('w.form.uploading')
                    : updateMutation.isPending
                      ? t('w.form.saving')
                      : t('w.form.save')}
                </Button>
              </div>
              {updateMutation.error && (
                <p className="text-sm text-destructive">
                  {t('w.form.saveFailed', { message: updateMutation.error.message })}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skus" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('w.products.skuListTitle')}</CardTitle>
              <CreateSkuDialog
                productId={id}
                onCreate={(input) => createSkuMutation.mutate({ productId: id, input })}
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
        </TabsContent>
      </Tabs>
    </>
  );
}

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
