/**
 * 商品详情/编辑页 — /products/[id]
 *
 * 后端：
 *   - GET/PATCH /admin/products/:id
 *   - PATCH /admin/products/:id/status
 *   - GET/POST /admin/products/:id/skus
 *
 * 三个 Tab：
 *   - 基本信息（编辑表单）
 *   - SKU 列表（新增/展示）
 *   - 危险操作（删除占位）
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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

type Locale = 'en' | 'zh' | 'id' | 'pt';

export default function ProductDetailPage() {
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

  // 加载完后填表单
  useEffect(() => {
    if (productQ.data?.data) {
      setName(productQ.data.data.name ?? {});
      setMainImage(productQ.data.data.mainImage ?? '');
      setDescription(productQ.data.data.description ?? {});
    }
  }, [productQ.data]);

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
      header: 'Name',
      render: (row) => <span className="font-medium">{row.name?.en ?? '—'}</span>,
    },
    {
      key: 'attributes',
      header: 'Attributes',
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
      header: 'Price',
      render: (row) => (
        <span className="font-mono text-xs">${(row.price / 100).toFixed(2)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={product.name?.en ?? product.id}
        breadcrumb={[
          { label: 'Products', href: '/products' },
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
            {product.status === 'ACTIVE' ? '下架' : '上架'}
          </Button>
        }
      />

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="skus">SKUs</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Edit Product</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {i18nInputs('Name', name, setName)}
              <div className="space-y-2">
                <Label>Main Image URL</Label>
                <Input value={mainImage} onChange={(e) => setMainImage(e.target.value)} />
                {mainImage && (
                  <img
                    src={mainImage}
                    alt=""
                    className="h-20 w-20 rounded border object-cover"
                  />
                )}
              </div>
              {i18nInputs('Description', description, setDescription)}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/products')}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveBasic}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
              {updateMutation.error && (
                <p className="text-sm text-destructive">
                  Save failed: {updateMutation.error.message}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skus" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>SKU List</CardTitle>
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
          New SKU
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create SKU for {productId}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label>Name (EN)</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Price (USD)</Label>
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
              <Label>Attribute Key</Label>
              <Input
                value={attrKey}
                onChange={(e) => setAttrKey(e.target.value)}
                placeholder="e.g. weight"
              />
            </div>
            <div className="space-y-1">
              <Label>Attribute Value</Label>
              <Input
                value={attrVal}
                onChange={(e) => setAttrVal(e.target.value)}
                placeholder="e.g. 500g"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
