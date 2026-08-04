/**
 * 评论管理列表页 — /reviews
 *
 * 后端：GET /admin/reviews（type=customer|rider + category/status/rating/keyword 筛选）
 * 两 tab：客户评论（reviews 表）/ 骑手评价（rider_reviews 表）
 * 视角：platform / merchant / support
 */
'use client';

import { useState, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAdminReviews,
  useDeleteReview,
  type Review,
  type RiderReview,
  type ReviewType,
  type ReviewStatus,
  type ReviewCategory,
} from '@/hooks/api/use-reviews';

type Row = Review | RiderReview;

const STATUS_FILTERS: { value: ReviewStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.reviews.statusAll' },
  { value: 'APPROVED', labelKey: 'admin.reviews.statusApproved' },
  { value: 'PENDING', labelKey: 'admin.reviews.statusPending' },
  { value: 'REJECTED', labelKey: 'admin.reviews.statusRejected' },
];

const CATEGORY_FILTERS: { value: ReviewCategory | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.reviews.categoryAll' },
  { value: 'PRODUCT', labelKey: 'admin.reviews.categoryProduct' },
  { value: 'DELIVERY', labelKey: 'admin.reviews.categoryDelivery' },
];

const RATING_FILTERS = ['ALL', '5', '4', '3', '2', '1'] as const;

export default function ReviewsListPage() {
  const t = useTranslations('common');
  const router = useRouter();
  const [tab, setTab] = useState<ReviewType>('customer');
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'ALL'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ReviewCategory | 'ALL'>('ALL');
  const [ratingFilter, setRatingFilter] = useState<(typeof RATING_FILTERS)[number]>('ALL');
  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword); // P1-9：debounce keyword，避免每键一搜放大后端 Json 全表扫描
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const { data, isLoading, error, refetch } = useAdminReviews({
    type: tab,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    category: tab === 'customer' && categoryFilter !== 'ALL' ? categoryFilter : undefined,
    rating: ratingFilter === 'ALL' ? undefined : Number(ratingFilter),
    keyword: deferredKeyword.trim() || undefined,
  });
  const deleteMutation = useDeleteReview(tab);

  const items: Row[] = (data?.items ?? []) as Row[];

  const columns: Column<Row>[] = [
    {
      key: 'userName',
      header: t('admin.reviews.columnReviewer'),
      render: (row) => <span className="text-sm font-medium">{row.userName}</span>,
    },
    {
      key: 'rating',
      header: t('admin.reviews.columnRating'),
      render: (row) => <span className="font-mono text-amber-500">{'★'.repeat(row.rating)}</span>,
    },
    {
      key: 'content',
      header: t('admin.reviews.columnContent'),
      render: (row) => {
        const text =
          tab === 'customer'
            ? ((row as Review).content?.en ?? '')
            : ((row as RiderReview).comment?.en ?? '');
        const tags = tab === 'rider' ? (row as RiderReview).tags : [];
        return (
          <div className="max-w-md space-y-1">
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {t(`admin.reviews.tag.${tag}`)}
                  </span>
                ))}
              </div>
            )}
            <p className="truncate text-xs text-muted-foreground">
              {text || t('admin.reviews.noText')}
            </p>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('admin.reviews.columnStatus'),
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
    },
    {
      key: 'createdAt',
      header: t('admin.reviews.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.push(`/reviews/${row.id}?type=${tab}`)}
          >
            {t('admin.reviews.viewButton')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteTarget(row)}
            disabled={deleteMutation.isPending}
          >
            {t('admin.reviews.deleteButton')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.reviews.title')} description={t('admin.reviews.description')} />

      {/* 客户评论 / 骑手评价 两 tab */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewType)}>
        <TabsList>
          <TabsTrigger value="customer">{t('admin.reviews.tabCustomer')}</TabsTrigger>
          <TabsTrigger value="rider">{t('admin.reviews.tabRider')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReviewStatus | 'ALL')}>
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {t(s.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {tab === 'customer' && (
          <Tabs
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as ReviewCategory | 'ALL')}
          >
            <TabsList>
              {CATEGORY_FILTERS.map((c) => (
                <TabsTrigger key={c.value} value={c.value}>
                  {t(c.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <Tabs
          value={ratingFilter}
          onValueChange={(v) => setRatingFilter(v as (typeof RATING_FILTERS)[number])}
        >
          <TabsList>
            {RATING_FILTERS.map((r) => (
              <TabsTrigger key={r} value={r}>
                {r === 'ALL' ? t('admin.reviews.ratingAll') : `${r}★`}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('admin.reviews.searchPlaceholder')}
          className="max-w-xs"
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.reviews.empty')}
          description={t('admin.reviews.emptyDescription')}
        />
      ) : (
        <>
          <DataTable data={items} columns={columns} />
          <p className="text-xs text-muted-foreground">
            {t('admin.reviews.totalCount', { count: data?.total ?? 0 })}
          </p>
        </>
      )}

      {/* 删除确认（硬删） */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.reviews.deleteDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.reviews.deleteDialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('admin.reviews.cancelButton')}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteTarget &&
                deleteMutation.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                })
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? t('admin.reviews.deletingButton')
                : t('admin.reviews.deleteConfirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
