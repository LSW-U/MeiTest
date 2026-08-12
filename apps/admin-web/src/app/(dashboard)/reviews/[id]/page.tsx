/**
 * 评论详情页 — /reviews/:id?type=customer|rider
 *
 * 后端：GET /admin/reviews/:id + PATCH /admin/reviews/:id
 * 功能：查看完整评论/评价 + 审核 status + 商家回复（仅客户评论）
 */
'use client';

import { useState, useEffect, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  useReviewDetail,
  useUpdateReview,
  type Review,
  type RiderReview,
  type ReviewType,
  type ReviewStatus,
} from '@/hooks/api/use-reviews';

function ReviewDetailContent() {
  const t = useTranslations('common');
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const type: ReviewType = searchParams.get('type') === 'rider' ? 'rider' : 'customer';

  const { data, isLoading, error, refetch } = useReviewDetail(id, type);
  const updateMutation = useUpdateReview(type);

  // 本地编辑态：审核 status + 商家回复
  const [status, setStatus] = useState<ReviewStatus>('APPROVED');
  const [replyEn, setReplyEn] = useState('');
  const [replyZh, setReplyZh] = useState('');

  useEffect(() => {
    if (data) {
      setStatus(data.status);
      const reply = (data as Review).reply;
      setReplyEn(reply?.en ?? '');
      setReplyZh(reply?.zh ?? '');
    }
  }, [data]);

  function handleSave() {
    if (!data) return;
    if (type === 'customer') {
      const reply: Record<string, string> = {};
      if (replyEn.trim()) reply.en = replyEn.trim();
      if (replyZh.trim()) reply.zh = replyZh.trim();
      const hasReply = Object.keys(reply).length > 0;
      updateMutation.mutate({
        id,
        input: { status, reply: hasReply ? reply : null }, // P1-8：null = 清除回复（undefined = 不改）
      });
    } else {
      updateMutation.mutate({ id, input: { status } });
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground">
        {t('loading')}
      </div>
    );
  }

  const isCustomer = type === 'customer';
  const review = data as Review;
  const riderReview = data as RiderReview;
  const content = isCustomer ? review.content?.en : riderReview.comment?.en;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.reviews.detailTitle')}
        description={t(isCustomer ? 'admin.reviews.tabCustomer' : 'admin.reviews.tabRider')}
      />

      <div className="rounded-md border p-4 space-y-3">
        <div className="flex items-center gap-4">
          <span className="text-sm">
            <span className="text-muted-foreground">{t('admin.reviews.fieldReviewer')}: </span>
            <span className="font-medium">{data.userName}</span>
            {isCustomer && review.anonymous && (
              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
                {t('admin.reviews.anonymousBadge')}
              </span>
            )}
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">{t('admin.reviews.columnRating')}: </span>
            <span className="font-mono text-amber-500">{'★'.repeat(data.rating)}</span>
          </span>
          <StatusBadge status={data.status} label={data.status} />
        </div>

        {/* 评价标签（骑手固定 4 枚举 / 客户商品评价 6 枚举，P15 B1 客户评价也展示 tags） */}
        {((!isCustomer && riderReview.tags.length > 0) ||
          (isCustomer && review.tags.length > 0)) && (
          <div className="flex flex-wrap gap-2">
            {(isCustomer ? review.tags : riderReview.tags).map((tag) => (
              <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs">
                {t(`admin.reviews.tag.${tag}`)}
              </span>
            ))}
          </div>
        )}

        {/* 评论内容 */}
        {content && <p className="text-sm">{content}</p>}

        {/* 客户评论图片 */}
        {isCustomer && review.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {review.images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={img}
                src={img}
                alt="review"
                className="h-20 w-20 rounded border object-cover"
              />
            ))}
          </div>
        )}

        <div className="flex gap-6 text-xs text-muted-foreground">
          <span>
            {t('admin.reviews.fieldOrder')}: {data.orderId}
          </span>
          {!isCustomer && (
            <span>
              {t('admin.reviews.fieldRider')}: {riderReview.riderId}
            </span>
          )}
          {isCustomer && review.productId && (
            <span>
              {t('admin.reviews.fieldProduct')}: {review.productId}
            </span>
          )}
          <span>
            {t('admin.reviews.columnCreatedAt')}: {new Date(data.createdAt).toLocaleString()}
          </span>
        </div>
      </div>

      {/* 审核操作 + 商家回复 */}
      <div className="rounded-md border p-4 space-y-4">
        <div className="space-y-2">
          <Label>{t('admin.reviews.fieldStatus')}</Label>
          <div className="flex gap-2">
            {(['APPROVED', 'PENDING', 'REJECTED'] as ReviewStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? 'default' : 'outline'}
                onClick={() => setStatus(s)}
              >
                {t(`admin.reviews.status${s.charAt(0)}${s.slice(1).toLowerCase()}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* 商家回复（仅客户评论） */}
        {isCustomer && (
          <div className="space-y-2">
            <Label>{t('admin.reviews.fieldReply')}</Label>
            <Textarea
              value={replyEn}
              onChange={(e) => setReplyEn(e.target.value)}
              placeholder={t('admin.reviews.replyPlaceholderEn')}
              rows={2}
            />
            <Textarea
              value={replyZh}
              onChange={(e) => setReplyZh(e.target.value)}
              placeholder={t('admin.reviews.replyPlaceholderZh')}
              rows={2}
            />
            {review.reply && review.repliedAt && (
              <p className="text-xs text-muted-foreground">
                {t('admin.reviews.repliedAt', {
                  time: new Date(review.repliedAt).toLocaleString(),
                })}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('admin.reviews.savingButton') : t('admin.reviews.saveButton')}
          </Button>
          <Link href="/reviews">
            <Button variant="outline">{t('admin.reviews.backButton')}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// P1-7：useSearchParams 必须包 Suspense（Next 14.2 build 要求），否则路由树 CSR 降级 + SSR 首屏 type 误判
export default function ReviewDetailPage() {
  const t = useTranslations('common');
  return (
    <Suspense
      fallback={
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      }
    >
      <ReviewDetailContent />
    </Suspense>
  );
}
