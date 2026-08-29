/**
 * 反馈管理页 - /feedback
 *
 * admin-web 优化方案 批次3（2026-08-29）
 * 后端：GET /admin/feedback（列表）+ GET /admin/feedback/:id（详情），MVP 只读
 *
 * 功能：
 *   - DataTable 列表（分类筛选 Tabs + 时间范围 + 关键词 + 分页）
 *   - 详情 Dialog（正文 / 联系方式 / 截图）复用 common 空态/错误态
 *   - 视角：platform
 */
'use client';

import { useState, useDeferredValue } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAdminFeedbackList,
  useAdminFeedbackDetail,
  type AdminFeedbackListItem,
  type FeedbackCategory,
} from '@/hooks/api/use-feedback';

type Row = AdminFeedbackListItem;

const PAGE_SIZE = 10;

const CATEGORY_FILTERS: { value: FeedbackCategory | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.feedback.categoryAll' },
  { value: 'feature', labelKey: 'admin.feedback.categoryFeature' },
  { value: 'product', labelKey: 'admin.feedback.categoryProduct' },
  { value: 'order', labelKey: 'admin.feedback.categoryOrder' },
  { value: 'payment', labelKey: 'admin.feedback.categoryPayment' },
  { value: 'shipping', labelKey: 'admin.feedback.categoryShipping' },
  { value: 'other', labelKey: 'admin.feedback.categoryOther' },
];

export default function FeedbackPage() {
  const t = useTranslations('common');
  const format = useFormatter();
  const [category, setCategory] = useState<FeedbackCategory | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAdminFeedbackList({
    category: category === 'ALL' ? undefined : category,
    keyword: deferredKeyword.trim() || undefined,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate).toISOString() : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const detail = useAdminFeedbackDetail(detailId);

  const items: Row[] = data?.items ?? [];

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** 应用时间筛选时重置回第 1 页 */
  function applyDateFilter() {
    setPage(1);
  }

  const columns: Column<Row>[] = [
    {
      key: 'submitter',
      header: t('admin.feedback.columnSubmitter'),
      render: (row) => (
        <div className="text-sm">
          <div className="font-medium">{row.submitter?.name ?? row.submitter?.phone ?? '-'}</div>
          {row.submitter?.phone && (
            <div className="text-xs text-muted-foreground">{row.submitter.phone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: t('admin.feedback.columnCategory'),
      render: (row) => (
        <Badge variant="outline">
          {t(`admin.feedback.category${cap(row.category)}` as 'admin.feedback.categoryFeature')}
        </Badge>
      ),
    },
    {
      key: 'content',
      header: t('admin.feedback.columnContent'),
      render: (row) => (
        <p className="max-w-md truncate text-xs text-muted-foreground">{row.content}</p>
      ),
    },
    {
      key: 'contact',
      header: t('admin.feedback.columnContact'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.contact ?? t('admin.feedback.noContact')}</span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.feedback.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setDetailId(row.id)}>
          {t('admin.feedback.detailTitle')}
        </Button>
      ),
    },
  ];

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.feedback.title')} description={t('admin.feedback.description')} />

      {/* 筛选条：分类 + 时间范围 + 关键词 */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={category} onValueChange={(v) => { setCategory(v as FeedbackCategory | 'ALL'); setPage(1); }}>
          <TabsList>
            {CATEGORY_FILTERS.map((c) => (
              <TabsTrigger key={c.value} value={c.value}>
                {t(c.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          aria-label={t('admin.feedback.filterStart')}
          className="max-w-[160px]"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          aria-label={t('admin.feedback.filterEnd')}
          className="max-w-[160px]"
        />
        <Button size="sm" variant="outline" onClick={applyDateFilter}>
          {t('admin.feedback.filterApply')}
        </Button>

        <Input
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          placeholder={t('admin.feedback.searchPlaceholder')}
          className="max-w-xs"
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.feedback.empty')}
          description={t('admin.feedback.emptyDescription')}
        />
      ) : (
        <>
          <DataTable
            data={items}
            columns={columns}
            emptyState={
              <EmptyState
                title={t('admin.feedback.empty')}
                description={t('admin.feedback.emptyDescription')}
              />
            }
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {t('admin.feedback.pageInfo', {
                page: data?.page ?? 1,
                total: totalPages,
                count: data?.total ?? 0,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('admin.feedback.pagePrev')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!data?.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('admin.feedback.pageNext')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* 详情 Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('admin.feedback.detailTitle')}</DialogTitle>
            <DialogDescription>{t('admin.feedback.description')}</DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
          ) : detail.error ? (
            <ErrorState onRetry={() => detail.refetch()} />
          ) : detail.data ? (
            <div className="space-y-4">
              <DetailField label={t('admin.feedback.fieldSubmitter')}>
                {detail.data.submitter?.name ?? detail.data.submitter?.phone ?? '-'}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldPhone')}>
                {detail.data.submitter?.phone ?? '-'}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldEmail')}>
                {detail.data.submitter?.email ?? '-'}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldRole')}>
                {detail.data.submitter?.role ?? '-'}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldStatus')}>
                {detail.data.submitter?.status ?? '-'}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldContact')}>
                {detail.data.contact ?? t('admin.feedback.noContact')}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldContent')}>
                <p className="whitespace-pre-wrap text-sm">{detail.data.content}</p>
              </DetailField>
              <DetailField label={t('admin.feedback.fieldImages')}>
                {detail.data.images.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t('admin.feedback.noImages')}</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {detail.data.images.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={url}
                        alt={t('admin.feedback.fieldImages')}
                        className="h-24 w-24 rounded border object-cover"
                      />
                    ))}
                  </div>
                )}
              </DetailField>
              <DetailField label={t('admin.feedback.fieldCreatedAt')}>
                {formatDateTime(detail.data.createdAt)}
              </DetailField>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 详情字段：label + 值块（统一两列对齐） */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

/** 首字母大写（category 值 → i18n key 后缀：feature → Feature） */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
