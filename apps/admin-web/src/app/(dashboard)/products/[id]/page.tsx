/**
 * 商品详情页 — /products/[id]
 *
 * 批C 重构为 5 tab 一页看完：基本信息 / 图片墙 / 库存 / 销量 / SKU
 *   - 基本信息：GET/PATCH /admin/products/:id（basic-tab.tsx）
 *   - 图片墙：  PATCH /admin/products/:id 的 mainImage + images[]（images-tab.tsx）
 *   - 库存：    GET /client/products/:id/detail 的 stocks[]/totalStock（批B 聚合，inventory-tab.tsx）
 *   - 销量：    同上 detail 的 salesCount/isCategoryTop3（sales-tab.tsx）
 *   - SKU：     GET/POST /admin/products/:id/skus（skus-tab.tsx）
 */
'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  useProduct,
  useUpdateProductStatus,
} from '@/hooks/api/use-products';
import { BasicTab } from './basic-tab';
import { ImagesTab } from './images-tab';
import { InventoryTab } from './inventory-tab';
import { SalesTab } from './sales-tab';
import { SkusTab } from './skus-tab';

export default function ProductDetailPage() {
  const t = useTranslations('common');
  const params = useParams<{ id: string }>();
  const id = params.id;

  const productQ = useProduct(id);
  const statusMutation = useUpdateProductStatus();

  if (productQ.isLoading) return <LoadingSkeleton lines={8} />;
  if (productQ.error)
    return (
      <ErrorState message={productQ.error.message} onRetry={() => productQ.refetch()} />
    );
  if (!productQ.data?.data) return null;

  const product = productQ.data.data;

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
          <TabsTrigger value="images">{t('w.products.tabImages')}</TabsTrigger>
          <TabsTrigger value="inventory">{t('w.products.tabInventory')}</TabsTrigger>
          <TabsTrigger value="sales">{t('w.products.tabSales')}</TabsTrigger>
          <TabsTrigger value="skus">{t('w.products.skuListTitle')}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <BasicTab productId={id} product={product} />
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <ImagesTab productId={id} product={product} />
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <InventoryTab productId={id} />
        </TabsContent>

        <TabsContent value="sales" className="space-y-4">
          <SalesTab productId={id} />
        </TabsContent>

        <TabsContent value="skus" className="space-y-4">
          <SkusTab productId={id} />
        </TabsContent>
      </Tabs>
    </>
  );
}
