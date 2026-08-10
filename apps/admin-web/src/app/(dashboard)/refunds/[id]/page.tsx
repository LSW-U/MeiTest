/**
 * 退款详情页 — /refunds/:id（P13 售后图片 2026-08-10）
 *
 * 后端：GET /admin/refunds/:id（复用孤儿 hook useRefundDetail）
 * 功能：
 *   - 展示完整 refund（amount/reason/reasonDetail/items/photos/status/reviewNote/timeline）
 *   - photos gallery 缩略图 onClick 弹 shadcn Dialog 放大（lightbox，决策点 3）
 *   - 详情页只读（不放审核按钮，审核仍走列表 Dialog，决策点 2）
 */
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import {
  useRefundDetail,
  type RefundItem,
} from '@/hooks/api/use-refunds';

/** reason → i18n key 映射（含 P13 EXPIRED/SHORTAGE） */
const REASON_LABEL_KEY: Record<string, string> = {
  OUT_OF_STOCK: 'admin.refunds.reasonOutOfStock',
  EXPIRED: 'admin.refunds.reasonExpired',
  QUALITY_ISSUE: 'admin.refunds.reasonQualityIssue',
  WRONG_ITEM: 'admin.refunds.reasonWrongItem',
  SHORTAGE: 'admin.refunds.reasonShortage',
  DELIVERY_TOO_SLOW: 'admin.refunds.reasonDeliveryTooSlow',
  CUSTOMER_CHANGE_MIND: 'admin.refunds.reasonCustomerChangeMind',
  OTHER: 'admin.refunds.reasonOther',
};

/** 取多语言商品名 fallback 链 en → 第一个值 → skuId */
function pickProductName(productName: Record<string, string>, skuId: string): string {
  return productName?.en ?? (productName ? Object.values(productName)[0] : '') ?? skuId;
}

export default function RefundDetailPage() {
  const t = useTranslations('common');
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: refund, isLoading, error } = useRefundDetail(id);

  // lightbox 状态（点击缩略图放大）
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !refund) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.push('/refunds')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {t('admin.refunds.detailBack')}
        </Button>
        <ErrorState
          message={error?.message ?? t('admin.refunds.detailNotFound')}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const reasonLabel = REASON_LABEL_KEY[refund.reason]
    ? t(REASON_LABEL_KEY[refund.reason])
    : refund.reason;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.refunds.detailTitle')}
        description={t('admin.refunds.detailDescription')}
      />

      <Button variant="ghost" onClick={() => router.push('/refunds')} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> {t('admin.refunds.detailBack')}
      </Button>

      {/* 基础信息卡 */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t('admin.refunds.detailRefundId')}: {refund.id.slice(0, 8)}
          </h2>
          <StatusBadge status={refund.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('admin.refunds.columnAmount')} value={formatCurrency(refund.amount)} />
          <Field label={t('admin.refunds.columnReason')} value={reasonLabel} />
          <Field
            label={t('admin.refunds.columnMethod')}
            value={refund.refundMethod}
          />
          <Field
            label={t('admin.refunds.columnAppliedAt')}
            value={new Date(refund.createdAt).toLocaleString()}
          />
          <Field
            label={t('admin.refunds.fieldOrderId')}
            value={
              <Link
                href={`/orders?orderId=${refund.orderId}`}
                className="text-primary underline"
              >
                {refund.orderId.slice(0, 8)}
              </Link>
            }
          />
          <Field
            label={t('admin.refunds.fieldTransactionId')}
            value={refund.transactionId ?? '—'}
          />
        </dl>
        {refund.reasonDetail && (
          <div className="space-y-1 border-t pt-4">
            <dt className="text-sm text-muted-foreground">
              {t('admin.refunds.fieldReasonDetail')}
            </dt>
            <dd className="text-sm">{refund.reasonDetail}</dd>
          </div>
        )}
      </section>

      {/* 退款商品明细（部分退款时展示） */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t('admin.refunds.fieldItems')}</h2>
        {refund.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.refunds.itemsEmpty')}</p>
        ) : (
          <ul className="space-y-3">
            {refund.items.map((it: RefundItem) => (
              <li key={it.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {pickProductName(it.productName, it.skuId)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('admin.refunds.itemUnitPrice')}: {formatCurrency(it.unitPrice)} ×{' '}
                    {it.refundQty}
                  </p>
                </div>
                <p className="text-sm font-semibold">{formatCurrency(it.subtotal)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 凭证照片 gallery（决策点 3：缩略图 + lightbox） */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="text-lg font-semibold">{t('admin.refunds.fieldPhotos')}</h2>
        {refund.photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.refunds.photosEmpty')}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {refund.photos.map((url, idx) => (
              <button
                key={url + idx}
                type="button"
                onClick={() => setLightboxSrc(url)}
                className="h-24 w-24 overflow-hidden rounded-md border hover:opacity-80"
                aria-label={t('admin.refunds.photoClickToEnlarge', { number: idx + 1 })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`evidence-${idx + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 审核信息（只读展示，不放审核按钮，决策点 2） */}
      {(refund.reviewedBy || refund.reviewedAt || refund.reviewNote) && (
        <section className="rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold">{t('admin.refunds.fieldReviewInfo')}</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('admin.refunds.fieldReviewedBy')}
              value={refund.reviewedBy?.slice(0, 8) ?? '—'}
            />
            <Field
              label={t('admin.refunds.fieldReviewedAt')}
              value={refund.reviewedAt ? new Date(refund.reviewedAt).toLocaleString() : '—'}
            />
            {refund.reviewNote && (
              <div className="space-y-1 sm:col-span-2">
                <dt className="text-sm text-muted-foreground">
                  {t('admin.refunds.fieldReviewNote')}
                </dt>
                <dd className="text-sm">{refund.reviewNote}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* lightbox Dialog（点击缩略图放大） */}
      <Dialog open={!!lightboxSrc} onOpenChange={(open) => !open && setLightboxSrc(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">
            {t('admin.refunds.photoLightboxTitle')}
          </DialogTitle>
          {lightboxSrc && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={lightboxSrc}
              alt="evidence-large"
              className="h-auto max-h-[80vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 字段展示原子组件 */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
