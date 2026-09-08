/**
 * 商品详情 · 销量 tab（批C 新增，消费批B 聚合详情）
 *
 * 展示真实 salesCount（批A 起由支付/退款事务维护）+ 分类 Top3 徽章。
 * 假数据保留不清零（批A 决策），UI 提示真实销量从生效日起累计。
 * 批量修改通道在列表页（勾选 → 设值 → PATCH /admin/products/sales-batch）
 */
'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { useProductDetail } from '@/hooks/api/use-products';

export function SalesTab({ productId }: { productId: string }) {
  const t = useTranslations('common');
  const detailQ = useProductDetail(productId);

  if (detailQ.isLoading) return <LoadingSkeleton lines={4} />;
  if (detailQ.error)
    return <ErrorState message={detailQ.error.message} onRetry={() => detailQ.refetch()} />;

  const detail = detailQ.data?.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('w.products.salesTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {t('w.products.currentSalesCount')}
            </div>
            <div className="font-mono text-3xl font-bold">{detail?.salesCount ?? 0}</div>
          </div>
          {detail?.isCategoryTop3 && (
            <Badge variant="warning">{t('w.products.top3Badge')}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('w.products.salesRealHint')}</p>
      </CardContent>
    </Card>
  );
}
