/**
 * 客服工作台 — /support（聚合页，只读）
 *
 * 批3 形态（方案v2-客服平台扩展-20261018）：单框智能分派 + 同页状态机 search→user→order
 *   1. 单框智能分派（决策1）：^MM → 订单链路；其余 keyword → users 列表
 *   2. 人级视图（决策2/3/4）：用户卡（口径=已成交）+ 地址簿 + 订单列表（10单+加载更多）
 *      + 人级退款/评论聚合（userId where 直出）；点订单项 → 切订单证据链视图
 *   3. 订单视图 = 批1/2 订单卡 + 任务 + 退款 + 评论区块（回归不破）+ 订单卡折叠增强（决策5）
 *   4. 全区块显式空态（决策6）
 *
 * React Query dependent query：下游区块在上游未命中时不发请求。
 * 只读约束：本页零写操作按钮。
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { EvidenceImageGroup } from '@/components/common/evidence-image-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import { useOrders, useOrderDetail } from '@/hooks/api/use-orders';
import {
  useDispatchTasks,
  type AdminDeliveryTask,
} from '@/hooks/api/use-dispatch';
import { useRefunds, type Refund } from '@/hooks/api/use-refunds';
import {
  useAdminReviews,
  type Review,
  type RiderReview,
} from '@/hooks/api/use-reviews';
import {
  useCustomers,
  useCustomerDetail,
  type CustomerListItem,
} from '@/hooks/api/use-customers';
import {
  canSearch,
  pickMatchedOrder,
  timelineState,
  shortRiderId,
  pickI18nText,
  dispatchSearchKind,
  userPickIntent,
  USER_ORDERS_PAGE_SIZE,
  visibleAddresses,
  type SupportView,
} from '@/lib/support-page';
import { formatCurrency } from '@/lib/utils';
import { SupportCardsGrid } from './support-cards-grid';

/** deliveryAddress 快照形状（order.service.ts :397；unknown 透传，收窄使用） */
interface DeliveryAddressSnapshot {
  name?: string;
  phone?: string;
  detail?: string;
}

/** OrderEvent 形状（order.service.ts :1649；前端只读展示） */
interface OrderEventView {
  id: string;
  eventType: string;
  toStatus: string;
  createdAt: string;
}

export default function SupportWorkbenchPage() {
  const t = useTranslations('common');
  const format = useFormatter();

  // ===== 状态机：search（搜索引导/人选择）→ user（人级视图）→ order（订单证据链） =====
  const [view, setView] = useState<SupportView>('search');
  const [input, setInput] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  // 分派结果在提交时锁定（切视图/返回不因输入框内容漂移）
  const [searchKind, setSearchKind] = useState<'order' | 'user' | null>(null);
  const [selectedUser, setSelectedUser] = useState<CustomerListItem | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // 订单卡折叠（决策5：摘要默认，详情折叠展开）
  const [orderDetailExpanded, setOrderDetailExpanded] = useState(false);
  // 地址簿卡折叠（微任务 20261018：默认前 3，其余收进「显示更多」）
  const [addressExpanded, setAddressExpanded] = useState(false);

  function submitSearch() {
    if (!canSearch(input)) return;
    const kind = dispatchSearchKind(input);
    if (!kind) return;
    setSubmittedKeyword(input.trim());
    setSearchKind(kind);
    setSelectedUser(null);
    setSelectedOrderId(null);
    setOrderDetailExpanded(false);
    setView(kind === 'order' ? 'order' : 'search'); // order 链路直进；user 链路先看命中数
  }

  function backToUser() {
    setSelectedOrderId(null);
    setOrderDetailExpanded(false);
    setView('user');
  }

  function openOrder(orderId: string) {
    setSelectedOrderId(orderId);
    setOrderDetailExpanded(false);
    setView('order');
  }

  // ===== 订单链路（^MM 前缀；批1/2 回归） =====
  const ordersQuery = useOrders(
    view === 'order' && searchKind === 'order' && submittedKeyword
      ? { orderNo: submittedKeyword, limit: 5 }
      : {},
    {
      enabled:
        view === 'order' && searchKind === 'order' && submittedKeyword.length > 0,
    },
  );
  const matchedOrder = ordersQuery.data
    ? pickMatchedOrder(ordersQuery.data.pages.flatMap((p) => p.items))
    : null;
  const orderId = matchedOrder?.id ?? null;

  const orderDetailQuery = useOrderDetail(orderId ?? undefined);

  const tasksQuery = useDispatchTasks(
    searchKind === 'order' && submittedKeyword ? { orderNo: submittedKeyword, limit: 20 } : {},
    { enabled: view === 'order' && orderId !== null },
  );
  const tasks: AdminDeliveryTask[] = tasksQuery.data
    ? tasksQuery.data.pages.flatMap((p) => p.items)
    : [];

  const refundsQuery = useRefunds(
    orderId ? { orderId, limit: 20 } : {},
    { enabled: view === 'order' && orderId !== null },
  );
  const refunds: Refund[] = refundsQuery.data
    ? refundsQuery.data.pages.flatMap((p) => p.items)
    : [];

  const customerReviewsQuery = useAdminReviews(
    { type: 'customer', orderId: orderId ?? undefined },
    { enabled: view === 'order' && orderId !== null },
  );
  const riderReviewsQuery = useAdminReviews(
    { type: 'rider', orderId: orderId ?? undefined },
    { enabled: view === 'order' && orderId !== null },
  );
  const allReviews: Array<Review | RiderReview> = [
    ...(customerReviewsQuery.data?.items ?? []),
    ...(riderReviewsQuery.data?.items ?? []),
  ];

  // ===== 用户链路（keyword；批3） =====
  const customersQuery = useCustomers(
    searchKind === 'user' && submittedKeyword && !selectedUser
      ? { keyword: submittedKeyword, pageSize: 20 }
      : {},
    {
      enabled:
        searchKind === 'user' &&
        submittedKeyword.length > 0 &&
        !selectedUser &&
        view !== 'order',
    },
  );
  const matchedCustomers: CustomerListItem[] = customersQuery.data?.items ?? [];
  const pickIntent = userPickIntent(matchedCustomers.length);

  // =1 命中直接进人视图（v2 §六；effect 触发一次，渲染期不落 setState）
  useEffect(() => {
    if (view === 'search' && pickIntent === 'direct' && matchedCustomers[0]) {
      setSelectedUser(matchedCustomers[0]);
      setView('user');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pickIntent, customersQuery.data]);

  // 人级视图数据源（selectedUser 锁定后各区块并发拉取）
  const userId = selectedUser?.id ?? null;
  const userDetailQuery = useCustomerDetail(userId ?? undefined);

  const userOrdersQuery = useOrders(
    userId ? { userId, limit: USER_ORDERS_PAGE_SIZE } : {},
    { enabled: view === 'user' && userId !== null },
  );
  const userOrders = userOrdersQuery.data
    ? userOrdersQuery.data.pages.flatMap((p) => p.items)
    : [];

  const userRefundsQuery = useRefunds(
    userId ? { userId, limit: 20 } : {},
    { enabled: view === 'user' && userId !== null },
  );
  const userRefunds: Refund[] = userRefundsQuery.data
    ? userRefundsQuery.data.pages.flatMap((p) => p.items)
    : [];

  const userCustomerReviewsQuery = useAdminReviews(
    { type: 'customer', userId: userId ?? undefined },
    { enabled: view === 'user' && userId !== null },
  );
  const userRiderReviewsQuery = useAdminReviews(
    { type: 'rider', userId: userId ?? undefined },
    { enabled: view === 'user' && userId !== null },
  );
  const userReviews: Array<Review | RiderReview> = [
    ...(userCustomerReviewsQuery.data?.items ?? []),
    ...(userRiderReviewsQuery.data?.items ?? []),
  ];

  // 订单视图（从人级订单列表点入）：复用订单链路区块，但订单来自 selectedOrderId
  const pickedOrderDetailQuery = useOrderDetail(selectedOrderId ?? undefined);
  const pickedOrder = pickedOrderDetailQuery.data ?? null;
  const pickedOrderTasksQuery = useDispatchTasks(
    pickedOrder?.orderNo ? { orderNo: pickedOrder.orderNo, limit: 20 } : {},
    { enabled: view === 'order' && !!pickedOrder?.orderNo },
  );
  const pickedOrderTasks: AdminDeliveryTask[] = pickedOrderTasksQuery.data
    ? pickedOrderTasksQuery.data.pages.flatMap((p) => p.items)
    : [];
  const pickedOrderRefundsQuery = useRefunds(
    selectedOrderId ? { orderId: selectedOrderId, limit: 20 } : {},
    { enabled: view === 'order' && selectedOrderId !== null },
  );
  const pickedOrderRefunds: Refund[] = pickedOrderRefundsQuery.data
    ? pickedOrderRefundsQuery.data.pages.flatMap((p) => p.items)
    : [];
  const pickedCustomerReviewsQuery = useAdminReviews(
    { type: 'customer', orderId: selectedOrderId ?? undefined },
    { enabled: view === 'order' && selectedOrderId !== null },
  );
  const pickedRiderReviewsQuery = useAdminReviews(
    { type: 'rider', orderId: selectedOrderId ?? undefined },
    { enabled: view === 'order' && selectedOrderId !== null },
  );
  const pickedOrderReviews: Array<Review | RiderReview> = [
    ...(pickedCustomerReviewsQuery.data?.items ?? []),
    ...(pickedRiderReviewsQuery.data?.items ?? []),
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
  const pickedAddress = pickedOrder
    ? (pickedOrder as unknown as { deliveryAddress?: DeliveryAddressSnapshot }).deliveryAddress
    : undefined;
  const pickedEvents = (pickedOrder as unknown as { events?: OrderEventView[] } | null)?.events ?? [];
  const userAddresses = userDetailQuery.data?.addresses ?? [];
  // 地址簿切片：收起显前 3，展开显全部（排序沿用后端现序，前端不另排）
  const {
    items: visibleAddressItems,
    hasMore: addressHasMore,
    hiddenCount: addressHiddenCount,
  } = visibleAddresses(userAddresses, addressExpanded);

  /** 订单摘要卡内容（订单链路与人级点入共用渲染） */
  function renderOrderEvidenceChain(opts: {
    orderNo: string;
    status: string;
    payableAmount: number;
    createdAt: string;
    address?: DeliveryAddressSnapshot;
    riderId: string | null;
    events: OrderEventView[];
    tasks: AdminDeliveryTask[];
    tasksPending: boolean;
    tasksError: Error | null;
    refunds: Refund[];
    refundsPending: boolean;
    refundsError: Error | null;
    reviews: Array<Review | RiderReview>;
    reviewsPending: boolean;
    reviewsError: Error | null;
  }) {
    return (
      <>
        {/* 订单摘要卡（只读；批3：详情折叠 = 事件时间线 + 地址簿） */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t('admin.support.orderSection')}
              <span className="font-mono text-sm text-muted-foreground">{opts.orderNo}</span>
              <StatusBadge status={opts.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.orderCardAmount')}</p>
                <p className="font-mono">{formatCurrency(opts.payableAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.orderCardCreatedAt')}</p>
                <p>{formatDateTime(opts.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.orderCardAddress')}</p>
                {opts.address?.detail ? (
                  <p>
                    {opts.address.name ?? ''} {opts.address.phone ?? ''}
                    <br />
                    {opts.address.detail}
                  </p>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.orderCardRider')}</p>
                {opts.riderId ? (
                  <span title={opts.riderId} className="font-mono text-xs">
                    {shortRiderId(opts.riderId)}
                  </span>
                ) : (
                  <span>{t('admin.support.orderCardNoRider')}</span>
                )}
              </div>
            </div>
            {/* 折叠：事件时间线 + 地址簿（决策5） */}
            <button
              type="button"
              onClick={() => setOrderDetailExpanded((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-foreground"
            >
              {orderDetailExpanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden />
              )}
              {t('admin.support.orderDetailToggle')}
            </button>
            {orderDetailExpanded && (
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('admin.support.orderEventsSection')}
                  </p>
                  {opts.events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    <ul className="space-y-1">
                      {opts.events.map((e) => (
                        <li key={e.id} className="text-xs">
                          <span className="font-mono">{e.eventType}</span>
                          <span className="text-muted-foreground"> → {e.toStatus} · </span>
                          {formatDateTime(e.createdAt)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('admin.support.orderAddressBookSection')}
                  </p>
                  {userAddresses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    <ul className="space-y-1">
                      {userAddresses.map((a) => (
                        <li key={a.id} className="text-xs">
                          {a.name} · {a.phone} · {a.region.province} {a.region.city} {a.detail}
                          {a.isDefault && (
                            <span className="ml-1 rounded bg-muted px-1 text-[10px]">
                              {t('admin.support.addressDefault')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 任务区块 */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.support.tasksSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {opts.tasksPending && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
              </div>
            )}
            {opts.tasksError && (
              <ErrorState message={opts.tasksError.message} onRetry={() => {}} />
            )}
            {!opts.tasksPending && !opts.tasksError && opts.tasks.length === 0 && (
              <EmptyState title={t('admin.support.tasksEmpty')} />
            )}
            {opts.tasks.map((task) => (
              <div key={task.id} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={task.status} label={task.status} />
                  {task.rider && (
                    <span className="text-muted-foreground">
                      {task.rider.riderName} · {task.rider.phone}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">{t('admin.support.taskTimeline')}</p>
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
                <EvidenceImageGroup
                  urls={task.evidenceUrls}
                  label={t('admin.support.evidencePhotosLabel')}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 退款区块 */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.support.refundsSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {opts.refundsPending && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
              </div>
            )}
            {opts.refundsError && (
              <ErrorState message={opts.refundsError.message} onRetry={() => {}} />
            )}
            {!opts.refundsPending && !opts.refundsError && opts.refunds.length === 0 && (
              <EmptyState title={t('admin.support.refundsEmpty')} />
            )}
            {opts.refunds.map((refund) => (
              <div key={refund.id} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={refund.status} label={refund.status} />
                  <span className="font-mono text-xs">{formatCurrency(refund.amount)}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(refund.createdAt)}</span>
                </div>
                <div className="text-sm">
                  <span className="text-xs text-muted-foreground">{t('admin.support.refundReason')}:</span>{' '}
                  {refund.reason}
                  {refund.reasonDetail ? ` — ${refund.reasonDetail}` : ''}
                </div>
                <EvidenceImageGroup
                  urls={refund.photos}
                  label={t('admin.support.refundPhotosLabel')}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 评论区块 */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.support.reviewsSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {opts.reviewsPending && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
              </div>
            )}
            {opts.reviewsError && (
              <ErrorState message={opts.reviewsError.message} onRetry={() => {}} />
            )}
            {!opts.reviewsPending && !opts.reviewsError && opts.reviews.length === 0 && (
              <EmptyState title={t('admin.support.reviewsEmpty')} />
            )}
            {opts.reviews.map((review) => {
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
                    <span className="text-xs text-muted-foreground">{formatDateTime(review.createdAt)}</span>
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
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.support.title')} description={t('admin.support.description')} />

      {/* 六卡网格（批1 20261018）：search 视图全展示；user/order 视图收起为单行入口 */}
      <SupportCardsGrid view={view} />

      {/* 搜索区（单框智能分派：MM→订单；其余→用户） */}
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

      {/* ===== 视图：search（初始引导 / 用户链路命中分流） ===== */}
      {view === 'search' && (
        <>
          {submittedKeyword === '' && (
            <EmptyState
              title={t('admin.support.searchLabel')}
              description={t('admin.support.emptyInputHint')}
            />
          )}
          {submittedKeyword !== '' && searchKind === 'user' && (
            <>
              {customersQuery.isPending && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {customersQuery.error && (
                <ErrorState
                  message={customersQuery.error.message}
                  onRetry={() => customersQuery.refetch()}
                />
              )}
              {!customersQuery.isPending && !customersQuery.error && pickIntent === 'none' && (
                <EmptyState
                  title={t('admin.support.userNotFoundTitle')}
                  description={t('admin.support.userNotFoundDescription')}
                />
              )}
              {pickIntent === 'direct' && (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {pickIntent === 'list' && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('admin.support.userPickerTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {matchedCustomers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(u);
                          setView('user');
                        }}
                        className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted"
                      >
                        <span>
                          <span className="font-medium">{u.name ?? '—'}</span>
                          <span className="ml-2 text-muted-foreground">{u.phone}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {u.orderCount} {t('admin.support.userPickerOrders')}
                        </span>
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* ===== 视图：user（人级聚合） ===== */}
      {view === 'user' && selectedUser && (
        <>
          {/* 返回搜索（P3-1 接线：人视图顶部返回，消费 backToSearch 键） */}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedUser(null);
                setSubmittedKeyword('');
                setSearchKind(null);
                setView('search');
              }}
            >
              {t('admin.support.backToSearch')}
            </Button>
          </div>
          {/* 用户卡 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t('admin.support.userSection')}
                <span className="text-base">{selectedUser.name ?? '—'}</span>
                <StatusBadge status={selectedUser.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.userCardPhone')}</p>
                <p className="font-mono">{selectedUser.phone}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.userCardEmail')}</p>
                <p>{selectedUser.email ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.userCardOrders')}</p>
                <p className="font-mono">{selectedUser.orderCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.userCardSpent')}</p>
                <p className="font-mono">{formatCurrency(selectedUser.totalSpent)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.support.userCardRegisteredAt')}</p>
                <p>{formatDateTime(selectedUser.createdAt)}</p>
              </div>
            </CardContent>
          </Card>

          {/* 地址簿卡（useCustomerDetail addresses） */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.support.addressBookSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {userDetailQuery.isPending && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {userDetailQuery.error && (
                <ErrorState
                  message={userDetailQuery.error.message}
                  onRetry={() => userDetailQuery.refetch()}
                />
              )}
              {!userDetailQuery.isPending && !userDetailQuery.error && userAddresses.length === 0 && (
                <EmptyState title={t('admin.support.addressBookEmpty')} />
              )}
              {visibleAddressItems.map((a) => (
                <div key={a.id} className="rounded-md border p-3 text-sm">
                  <p>
                    {a.name} · <span className="font-mono">{a.phone}</span>
                    {a.isDefault && (
                      <span className="ml-2 rounded bg-muted px-1 text-[10px]">
                        {t('admin.support.addressDefault')}
                      </span>
                    )}
                    {a.lastUsedAt && (
                      <span className="ml-2 rounded bg-muted px-1 text-[10px]">
                        {t('admin.support.addressRecentlyUsed')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.region.province} {a.region.city} {a.region.district ?? ''} {a.detail}
                  </p>
                </div>
              ))}
              {addressHasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddressExpanded((v) => !v)}
                >
                  {addressExpanded
                    ? t('admin.support.addressShowLess')
                    : t('admin.support.addressShowMore', { count: addressHiddenCount })}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* 订单列表卡（最近 10 单 + 加载更多；点项进订单证据链） */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.support.userOrdersSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {userOrdersQuery.isPending && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {userOrdersQuery.error && (
                <ErrorState
                  message={userOrdersQuery.error.message}
                  onRetry={() => userOrdersQuery.refetch()}
                />
              )}
              {!userOrdersQuery.isPending && !userOrdersQuery.error && userOrders.length === 0 && (
                <EmptyState title={t('admin.support.userOrdersEmpty')} />
              )}
              {userOrders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => openOrder(o.id)}
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{o.orderNo}</span>
                    <StatusBadge status={o.status} />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{formatCurrency(o.payableAmount)}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(o.createdAt)}</span>
                  </span>
                </button>
              ))}
              {userOrdersQuery.hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void userOrdersQuery.fetchNextPage()}
                  disabled={userOrdersQuery.isFetchingNextPage}
                >
                  {userOrdersQuery.isFetchingNextPage && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                  )}
                  {t('admin.support.loadMore')}
                </Button>
              )}
              {userOrders.length > 0 && (
                <p className="text-xs text-muted-foreground">{t('admin.support.userOrdersHint')}</p>
              )}
            </CardContent>
          </Card>

          {/* 人级退款聚合卡（userId where 直出） */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.support.userRefundsSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {userRefundsQuery.isPending && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {userRefundsQuery.error && (
                <ErrorState
                  message={userRefundsQuery.error.message}
                  onRetry={() => userRefundsQuery.refetch()}
                />
              )}
              {!userRefundsQuery.isPending && !userRefundsQuery.error && userRefunds.length === 0 && (
                <EmptyState title={t('admin.support.refundsEmpty')} />
              )}
              {userRefunds.map((refund) => (
                <div key={refund.id} className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge status={refund.status} label={refund.status} />
                    <span className="font-mono text-xs">{formatCurrency(refund.amount)}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(refund.createdAt)}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-muted-foreground">{t('admin.support.refundReason')}:</span>{' '}
                    {refund.reason}
                    {refund.reasonDetail ? ` — ${refund.reasonDetail}` : ''}
                  </div>
                  <EvidenceImageGroup
                    urls={refund.photos}
                    label={t('admin.support.refundPhotosLabel')}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 人级评论聚合卡（userId where 直出；两表类型徽章） */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.support.userReviewsSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(userCustomerReviewsQuery.isPending || userRiderReviewsQuery.isPending) && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {(userCustomerReviewsQuery.error || userRiderReviewsQuery.error) && (
                <ErrorState
                  message={(userCustomerReviewsQuery.error ?? userRiderReviewsQuery.error)?.message}
                  onRetry={() => {
                    userCustomerReviewsQuery.refetch();
                    userRiderReviewsQuery.refetch();
                  }}
                />
              )}
              {!userCustomerReviewsQuery.isPending &&
                !userRiderReviewsQuery.isPending &&
                !(userCustomerReviewsQuery.error || userRiderReviewsQuery.error) &&
                userReviews.length === 0 && <EmptyState title={t('admin.support.reviewsEmpty')} />}
              {userReviews.map((review) => {
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
                      <span className="text-xs text-muted-foreground">{formatDateTime(review.createdAt)}</span>
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

      {/* ===== 视图：order ===== */}
      {view === 'order' && (
        <>
          {/* 来自订单链路（^MM）：批1/2 回归 */}
          {searchKind === 'order' && (
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
                  {renderOrderEvidenceChain({
                    orderNo: matchedOrder.orderNo,
                    status: matchedOrder.status,
                    payableAmount: matchedOrder.payableAmount,
                    createdAt: matchedOrder.createdAt,
                    address,
                    riderId: orderDetailQuery.data?.riderId ?? null,
                    events: (orderDetailQuery.data as unknown as { events?: OrderEventView[] } | null)
                      ?.events ?? [],
                    tasks,
                    tasksPending: tasksQuery.isPending,
                    tasksError: tasksQuery.error,
                    refunds,
                    refundsPending: refundsQuery.isPending,
                    refundsError: refundsQuery.error,
                    reviews: allReviews,
                    reviewsPending: customerReviewsQuery.isPending || riderReviewsQuery.isPending,
                    reviewsError: customerReviewsQuery.error ?? riderReviewsQuery.error,
                  })}
                  {backToUserNode()}
                </>
              )}
            </>
          )}
          {/* 来自人级订单列表点入 */}
          {searchKind === 'user' && selectedOrderId && pickedOrder && (
            <>
              {renderOrderEvidenceChain({
                orderNo: pickedOrder.orderNo,
                status: pickedOrder.status,
                payableAmount: pickedOrder.payableAmount,
                createdAt: pickedOrder.createdAt,
                address: pickedAddress,
                riderId: pickedOrder.riderId ?? null,
                events: pickedEvents,
                tasks: pickedOrderTasks,
                tasksPending: pickedOrderTasksQuery.isPending,
                tasksError: pickedOrderTasksQuery.error,
                refunds: pickedOrderRefunds,
                refundsPending: pickedOrderRefundsQuery.isPending,
                refundsError: pickedOrderRefundsQuery.error,
                reviews: pickedOrderReviews,
                reviewsPending:
                  pickedCustomerReviewsQuery.isPending || pickedRiderReviewsQuery.isPending,
                reviewsError: pickedCustomerReviewsQuery.error ?? pickedRiderReviewsQuery.error,
              })}
              {backToUserNode()}
            </>
          )}
        </>
      )}
    </div>
  );

  /** 订单视图 → 人级视图返回按钮（仅人级点入链路有；订单链路无 user 可回） */
  function backToUserNode() {
    if (!selectedUser) return null;
    return (
      <div>
        <Button variant="outline" size="sm" onClick={backToUser}>
          {t('admin.support.backToUser')}
        </Button>
      </div>
    );
  }
}
