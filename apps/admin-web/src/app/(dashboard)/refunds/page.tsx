/**
 * 退款管理页 — /refunds
 *
 * 后端：GET /admin/refunds + POST /admin/refunds/:id/review
 * 视角：platform（super_admin / warehouse_staff / customer_service）
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useRefunds,
  useReviewRefund,
  type Refund,
  type RefundStatus,
} from '@/hooks/api/use-refunds';
import { formatCurrency } from '@/lib/utils';

type RefundReason =
  | 'OUT_OF_STOCK'
  | 'QUALITY_ISSUE'
  | 'WRONG_ITEM'
  | 'DELIVERY_TOO_SLOW'
  | 'CUSTOMER_CHANGE_MIND'
  | 'OTHER';

const STATUS_FILTERS: { value: RefundStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.refunds.statusAll' },
  { value: 'PENDING', labelKey: 'admin.refunds.statusPending' },
  { value: 'COMPLETED', labelKey: 'admin.refunds.statusCompleted' },
  { value: 'REJECTED', labelKey: 'admin.refunds.statusRejected' },
  { value: 'CANCELLED', labelKey: 'admin.refunds.statusCancelled' },
];

const REASON_LABEL_KEY: Record<RefundReason, string> = {
  OUT_OF_STOCK: 'admin.refunds.reasonOutOfStock',
  QUALITY_ISSUE: 'admin.refunds.reasonQualityIssue',
  WRONG_ITEM: 'admin.refunds.reasonWrongItem',
  DELIVERY_TOO_SLOW: 'admin.refunds.reasonDeliveryTooSlow',
  CUSTOMER_CHANGE_MIND: 'admin.refunds.reasonCustomerChangeMind',
  OTHER: 'admin.refunds.reasonOther',
};

export default function RefundsListPage() {
  const t = useTranslations('common');
  const [statusFilter, setStatusFilter] = useState<RefundStatus | 'ALL'>('PENDING');
  const [rejectTarget, setRejectTarget] = useState<Refund | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [approveTarget, setApproveTarget] = useState<Refund | null>(null);

  const { data, isLoading, error, refetch } = useRefunds(
    statusFilter === 'ALL' ? undefined : statusFilter,
  );
  const reviewMutation = useReviewRefund();

  const items: Refund[] = data ?? [];

  function handleApproveSubmit() {
    if (!approveTarget) return;
    reviewMutation.mutate(
      { id: approveTarget.id, input: { action: 'APPROVE' } },
      { onSuccess: () => setApproveTarget(null) },
    );
  }

  function handleRejectSubmit() {
    if (!rejectTarget) return;
    reviewMutation.mutate(
      { id: rejectTarget.id, input: { action: 'REJECT', reviewNote: rejectNote } },
      {
        onSuccess: () => {
          setRejectTarget(null);
          setRejectNote('');
        },
      },
    );
  }

  const columns: Column<Refund>[] = [
    {
      key: 'amount',
      header: t('admin.refunds.columnAmount'),
      render: (row) => (
        <span className="font-mono text-sm font-bold text-destructive">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('admin.refunds.columnReason'),
      render: (row) => (
        <div className="space-y-0.5">
          <span className="text-sm font-medium">
            {REASON_LABEL_KEY[row.reason as RefundReason]
              ? t(REASON_LABEL_KEY[row.reason as RefundReason])
              : row.reason}
          </span>
          {row.reasonDetail && (
            <p className="text-xs text-muted-foreground">{row.reasonDetail}</p>
          )}
        </div>
      ),
    },
    {
      key: 'refundMethod',
      header: t('admin.refunds.columnMethod'),
      render: (row) => (
        <span className="text-muted-foreground">{row.refundMethod}</span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.refunds.columnAppliedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.refunds.columnStatus'),
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'PENDING' ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setApproveTarget(row)}
              disabled={reviewMutation.isPending}
            >
              {t('admin.refunds.approveButton')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setRejectTarget(row);
                setRejectNote('');
              }}
            >
              {t('admin.refunds.rejectButton')}
            </Button>
          </div>
        ) : row.transactionId ? (
          <span className="font-mono text-xs text-muted-foreground">
            {row.transactionId.slice(0, 20)}...
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.refunds.title')}
        description={t('admin.refunds.description')}
      />

      <Tabs
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as RefundStatus | 'ALL')}
      >
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {t(s.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.refunds.empty', {
            status:
              t(
                STATUS_FILTERS.find((s) => s.value === statusFilter)?.labelKey ??
                  'admin.refunds.statusAll',
              ),
          })}
          description={t('admin.refunds.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 通过确认 */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.refunds.approveDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.refunds.approveDialogDescription', {
                amount: approveTarget ? formatCurrency(approveTarget.amount) : '',
                method: approveTarget?.refundMethod ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              {t('admin.refunds.commonCancel')}
            </Button>
            <Button onClick={handleApproveSubmit} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending
                ? t('admin.refunds.approveDialogSubmitting')
                : t('admin.refunds.approveDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 驳回 */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.refunds.rejectDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.refunds.rejectDialogDescription', {
                amount: rejectTarget ? formatCurrency(rejectTarget.amount) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">{t('admin.refunds.rejectDialogReasonLabel')}</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder={t('admin.refunds.rejectDialogReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              {t('admin.refunds.commonCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={!rejectNote.trim() || reviewMutation.isPending}
            >
              {t('admin.refunds.rejectDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
