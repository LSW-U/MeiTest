/**
 * 骑手审核列表页 — /riders
 *
 * 后端：GET /admin/rider-applications + POST /admin/rider-applications/:id/review
 * 视角：rider-mgmt（super_admin 专属）
 *
 * 参考 6amMart Rider Management
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
  useRiderApplications,
  useReviewApplication,
  type RiderApplication,
  type ApplicationStatus,
} from '@/hooks/api/use-riders';

const STATUS_FILTERS: ApplicationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

const STATUS_LABEL_KEY: Record<ApplicationStatus, string> = {
  PENDING: 'admin.riders.statusPending',
  APPROVED: 'admin.riders.statusApproved',
  REJECTED: 'admin.riders.statusRejected',
};

export default function RidersListPage() {
  const t = useTranslations('common');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus>('PENDING');
  const [approveTarget, setApproveTarget] = useState<RiderApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RiderApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, error, refetch } = useRiderApplications({
    status: statusFilter,
    limit: 50,
  });
  const reviewMutation = useReviewApplication();

  // W4-REVIEW P0-6 修复：data 是 { items: [...] } 不是数组
  const items: RiderApplication[] = data?.items ?? [];

  function handleApproveSubmit() {
    if (!approveTarget) return;
    reviewMutation.mutate(
      { id: approveTarget.id, input: { decision: 'APPROVED' } },
      {
        onSuccess: () => {
          setApproveTarget(null);
        },
      },
    );
  }

  function handleRejectSubmit() {
    if (!rejectTarget) return;
    reviewMutation.mutate(
      { id: rejectTarget.id, input: { decision: 'REJECTED', rejectReason } },
      {
        onSuccess: () => {
          setRejectTarget(null);
          setRejectReason('');
        },
      },
    );
  }

  const columns: Column<RiderApplication>[] = [
    {
      key: 'riderName',
      header: t('admin.riders.columnName'),
      render: (row) => <span className="font-medium">{row.riderName}</span>,
    },
    {
      key: 'phone',
      header: t('admin.riders.columnPhone'),
      render: (row) => <span className="font-mono text-xs">{row.phone}</span>,
    },
    {
      key: 'vehicleType',
      header: t('admin.riders.columnVehicle'),
      render: (row) => (
        <span className="text-muted-foreground">
          {row.vehicleType} {row.vehiclePlate ? `(${row.vehiclePlate})` : ''}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.riders.columnAppliedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'applicationStatus',
      header: t('admin.riders.columnStatus'),
      render: (row) => <ApplicationStatusBadge status={row.applicationStatus} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.applicationStatus === 'PENDING' ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setApproveTarget(row)}
              disabled={reviewMutation.isPending}
            >
              {t('admin.riders.approveButton')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setRejectTarget(row);
                setRejectReason('');
              }}
            >
              {t('admin.riders.rejectButton')}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.riders.title')} description={t('admin.riders.description')} />

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as ApplicationStatus)}>
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(STATUS_LABEL_KEY[s])}
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
          title={t('admin.riders.empty', { status: t(STATUS_LABEL_KEY[statusFilter]) })}
          description={t('admin.riders.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 审核通过确认弹窗（W4-REVIEW P1-3 修复：替代原生 confirm()） */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.approveDialogTitle')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{approveTarget?.riderName}</span>
              {' '}
              ({approveTarget?.phone}) — {t('admin.riders.approveDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              {t('admin.riders.commonCancel')}
            </Button>
            <Button onClick={handleApproveSubmit} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? t('loading') : t('admin.riders.approveDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 审核拒绝确认弹窗 */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.rejectDialogTitle')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{rejectTarget?.riderName}</span>
              {' '}
              ({rejectTarget?.phone}) — {t('admin.riders.rejectDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">{t('admin.riders.rejectDialogReasonLabel')}</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('admin.riders.rejectDialogReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              {t('admin.riders.commonCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim() || reviewMutation.isPending}
            >
              {t('admin.riders.rejectDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations('common');
  return <StatusBadge status={status} label={t(STATUS_LABEL_KEY[status])} />;
}
