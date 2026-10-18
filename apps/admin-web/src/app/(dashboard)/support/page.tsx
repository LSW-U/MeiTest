/**
 * 客服工作台 — /support（聚合页，只读）
 *
 * 形态 A · 单页聚合（方案 v2 §三批 1，20261018）：
 *   1. orderNo 搜索框（回车/按钮触发；空输入不发请求）
 *   2. 命中 → 订单摘要卡（状态/金额/收货地址/骑手/时间；只读零写按钮）
 *   3. 任务区块实数据：useDispatchTasks 传 orderNo（后端已支持 contains 过滤）
 *      → 任务卡时间线（assigned/pickedUp/delivered）+ EvidenceImageGroup 取证照片组
 *   4. 退款/评论两区块：占位空态（反查能力后续批次接入）
 *   5. 未命中/加载/错误三态
 *
 * React Query dependent query：订单未命中（orderId 空）时任务区块不发请求。
 * 只读约束：本页零写操作按钮（改派/取消/审核全留原页）。
 */
'use client';

import { useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { EvidenceImageGroup } from '@/components/common/evidence-image-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { useOrders, useOrderDetail } from '@/hooks/api/use-orders';
import { useDispatchTasks, type AdminDeliveryTask } from '@/hooks/api/use-dispatch';
import { useRefunds, type Refund } from '@/hooks/api/use-refunds';
import {
  useAdminReviews,
  type Review,
  type RiderReview,
} from '@/hooks/api/use-reviews';
import {
  canSearch,
  pickMatchedOrder,
  timelineState,
  shortRiderId,
  pickI18nText,
} from '@/lib/support-page';
import { formatCurrency } from '@/lib/utils';

/** deliveryAddress 快照形状（order.service.ts :397；unknown 透传，收窄使用） */
interface DeliveryAddressSnapshot {
  name?: string;
  phone?: string;
  detail?: string;
}

export default function SupportWorkbenchPage() {
  const t = useTranslations('common');
  const format = useFormatter();

  // 搜索输入与已提交关键词分离：仅提交后触发查询（空输入零请求）
  const [input, setInput] = useState('');
  const [submittedOrderNo, setSubmittedOrderNo] = useState('');

  function submitSearch() {
    if (!canSearch(input)) return;
    setSubmittedOrderNo(input.trim());
  }

  // 订单搜索（contains + insensitive，后端 listAllOrders 已支持）
  const ordersQuery = useOrders(
    submittedOrderNo ? { orderNo: submittedOrderNo, limit: 5 } : {},
    { enabled: submittedOrderNo.length > 0 },
  );
  const matchedOrder = ordersQuery.data
    ? pickMatchedOrder(ordersQuery.data.pages.flatMap((p) => p.items))
    : null;
  const orderId = matchedOrder?.id ?? null;

  // 订单详情（dependent）：列表接口无 riderId，详情取（骑手信息优先用任务卡 rider 摘要）
  const orderDetailQuery = useOrderDetail(orderId ?? undefined);

  // 任务区块：dependent query，orderId 为空时不发请求
  const tasksQuery = useDispatchTasks(
    submittedOrderNo ? { orderNo: submittedOrderNo, limit: 20 } : {},
    { enabled: orderId !== null },
  );
  const tasks: AdminDeliveryTask[] = tasksQuery.data
    ? tasksQuery.data.pages.flatMap((p) => p.items)
    : [];

  // 退款区块（批2）：orderId 反查，dependent query
  const refundsQuery = useRefunds(orderId ? { orderId, limit: 20 } : {}, {
    enabled: orderId !== null,
  });
  const refunds: Refund[] = refundsQuery.data
    ? refundsQuery.data.pages.flatMap((p) => p.items)
    : [];

  // 评论区块（批2）：customer + rider 两路并发 orderId 反查，dependent query
  const customerReviewsQuery = useAdminReviews(
    { type: 'customer', orderId: orderId ?? undefined },
    { enabled: orderId !== null },
  );
  const riderReviewsQuery = useAdminReviews(
    { type: 'rider', orderId: orderId ?? undefined },
    { enabled: orderId !== null },
  );
  const allReviews: Array<Review | RiderReview> = [
    ...(customerReviewsQuery.data?.items ?? []),
    ...(riderReviewsQuery.data?.items ?? []),
  ];

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const address = (matchedOrder as unknown as { deliveryAddress?: DeliveryAddressSnapshot } | null)
    ?.deliveryAddress;

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.support.title')} description={t('admin.support.description')} />

      {/* 搜索区：回车 / 按钮触发；空输入不发请求 */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="min-w-[260px] flex-1 space-y-1">
            <label htmlFor="support-order-no" className="text-sm font-medium">
              {t('admin.support.searchLabel')}
            </label>
            <Input
              id="support-order-no"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSearch();
              }}
              placeholder={t('admin.support.searchPlaceholder')}
            />
          </div>
          <Button type="button" onClick={submitSearch}>
            <Search className="mr-1 h-4 w-4" aria-hidden />
            {t('admin.support.searchButton')}
          </Button>
        </CardContent>
      </Card>

      {/* 未提交任何搜索 → 引导空态 */}
      {submittedOrderNo === '' && (
        <EmptyState title={t('admin.support.searchLabel')} description={t('admin.support.emptyInputHint')} />
      )}

      {/* 已提交：加载 / 错误 / 未命中 / 命中 */}
      {submittedOrderNo !== '' && (
        <>
          {ordersQuery.isPending && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
          {ordersQuery.error && (
            <ErrorState message={ordersQuery.error.message} onRetry={() => ordersQuery.refetch()} />
          )}
          {!ordersQuery.isPending && !ordersQuery.error && !matchedOrder && (
            <EmptyState
              title={t('admin.support.notFoundTitle')}
              description={t('admin.support.notFoundDescription')}
            />
          )}

          {matchedOrder && (
            <>
              {/* 订单摘要卡（只读） */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {t('admin.support.orderSection')}
                    <span className="font-mono text-sm text-muted-foreground">
                      {matchedOrder.orderNo}
                    </span>
                    <StatusBadge status={matchedOrder.status} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('admin.support.orderCardAmount')}</p>
                    <p className="font-mono">{formatCurrency(matchedOrder.payableAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('admin.support.orderCardCreatedAt')}</p>
                    <p>{formatDateTime(matchedOrder.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('admin.support.orderCardAddress')}</p>
                    {address?.detail ? (
                      <p>
                        {address.name ?? ''} {address.phone ?? ''}
                        <br />
                        {address.detail}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('admin.support.orderCardRider')}</p>
                    {/* 后端订单详情仅透出 riderId（无姓名）；短格式展示避免裸 UUID，完整值进 title */}
                    {orderDetailQuery.data?.riderId ? (
                      <span title={orderDetailQuery.data.riderId} className="font-mono text-xs">
                        {shortRiderId(orderDetailQuery.data.riderId)}
                      </span>
                    ) : (
                      <span>{t('admin.support.orderCardNoRider')}</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 任务区块（实数据：时间线 + 取证照片组） */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('admin.support.tasksSection')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {tasksQuery.isPending && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                    </div>
                  )}
                  {tasksQuery.error && (
                    <ErrorState message={tasksQuery.error.message} onRetry={() => tasksQuery.refetch()} />
                  )}
                  {!tasksQuery.isPending && !tasksQuery.error && tasks.length === 0 && (
                    <EmptyState title={t('admin.support.tasksEmpty')} />
                  )}
                  {tasks.map((task) => (
                    <div key={task.id} className="space-y-3 rounded-md border p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <StatusBadge status={task.status} label={task.status} />
                        {task.rider && (
                          <span className="text-muted-foreground">
                            {task.rider.riderName} · {task.rider.phone}
                          </span>
                        )}
                      </div>
                      {/* 时间线 */}
                      <div className="text-xs text-muted-foreground">
                        <p className="mb-1 font-medium text-foreground">
                          {t('admin.support.taskTimeline')}
                        </p>
                        <ul className="space-y-1">
                          <li>
                            {t('admin.support.timelineAssigned')}:{' '}
                            {timelineState(task.assignedAt) === 'done'
                              ? formatDateTime(task.assignedAt as string)
                              : t('admin.support.timelineNotYet')}
                          </li>
                          <li>
                            {t('admin.support.timelinePickedUp')}:{' '}
                            {timelineState(task.pickedUpAt) === 'done'
                              ? formatDateTime(task.pickedUpAt as string)
                              : t('admin.support.timelineNotYet')}
                          </li>
                          <li>
                            {t('admin.support.timelineDelivered')}:{' '}
                            {timelineState(task.deliveredAt) === 'done'
                              ? formatDateTime(task.deliveredAt as string)
                              : t('admin.support.timelineNotYet')}
                          </li>
                        </ul>
                      </div>
                      {/* 取证照片组（复用取证模块组件，零手写 img） */}
                      <EvidenceImageGroup
                        urls={task.evidenceUrls}
                        label={t('admin.support.evidencePhotosLabel')}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* 退款区块（批2 实数据：orderId 反查；凭证照片走 EvidenceImageGroup） */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('admin.support.refundsSection')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {refundsQuery.isPending && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                    </div>
                  )}
                  {refundsQuery.error && (
                    <ErrorState message={refundsQuery.error.message} onRetry={() => refundsQuery.refetch()} />
                  )}
                  {!refundsQuery.isPending && !refundsQuery.error && refunds.length === 0 && (
                    <EmptyState title={t('admin.support.refundsEmpty')} />
                  )}
                  {refunds.map((refund) => (
                    <div key={refund.id} className="space-y-3 rounded-md border p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <StatusBadge status={refund.status} label={refund.status} />
                        <span className="font-mono text-xs">
                          {formatCurrency(refund.amount)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(refund.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-xs text-muted-foreground">
                          {t('admin.support.refundReason')}:
                        </span>{' '}
                        {refund.reason}
                        {refund.reasonDetail ? ` — ${refund.reasonDetail}` : ''}
                      </div>
                      {/* 凭证照片组（复用取证模块组件，零手写 img） */}
                      <EvidenceImageGroup
                        urls={refund.photos}
                        label={t('admin.support.refundPhotosLabel')}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* 评论区块（批2 实数据：customer + rider 两路 orderId 反查；晒图走 EvidenceImageGroup） */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('admin.support.reviewsSection')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(customerReviewsQuery.isPending || riderReviewsQuery.isPending) && (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                    </div>
                  )}
                  {(customerReviewsQuery.error || riderReviewsQuery.error) && (
                    <ErrorState
                      message={
                        (customerReviewsQuery.error ?? riderReviewsQuery.error)?.message
                      }
                      onRetry={() => {
                        customerReviewsQuery.refetch();
                        riderReviewsQuery.refetch();
                      }}
                    />
                  )}
                  {!customerReviewsQuery.isPending &&
                    !riderReviewsQuery.isPending &&
                    !(customerReviewsQuery.error || riderReviewsQuery.error) &&
                    allReviews.length === 0 && <EmptyState title={t('admin.support.reviewsEmpty')} />}
                  {allReviews.map((review) => {
                    const isRider = 'riderId' in review;
                    const commentText = isRider
                      ? pickI18nText((review as RiderReview).comment)
                      : pickI18nText((review as Review).content);
                    return (
                      <div key={review.id} className="space-y-3 rounded-md border p-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-xs font-medium">
                            {isRider
                              ? t('admin.support.reviewTypeRider')
                              : t('admin.support.reviewTypeCustomer')}
                          </span>
                          <StatusBadge status={review.status} label={review.status} />
                          <span className="text-xs text-muted-foreground">
                            {review.userName} · {'★'.repeat(review.rating)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(review.createdAt)}
                          </span>
                        </div>
                        {commentText && <p className="text-sm">{commentText}</p>}
                        <EvidenceImageGroup
                          urls={isRider ? [] : (review as Review).images}
                          label={t('admin.support.reviewPhotosLabel')}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
