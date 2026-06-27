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

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
};

export default function RidersListPage() {
  const t = useTranslations();
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
      header: 'Name',
      render: (row) => <span className="font-medium">{row.riderName}</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => <span className="font-mono text-xs">{row.phone}</span>,
    },
    {
      key: 'vehicleType',
      header: 'Vehicle',
      render: (row) => (
        <span className="text-muted-foreground">
          {row.vehicleType} {row.vehiclePlate ? `(${row.vehiclePlate})` : ''}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Applied At',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'applicationStatus',
      header: 'Status',
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
              通过
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setRejectTarget(row);
                setRejectReason('');
              }}
            >
              拒绝
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
              {STATUS_LABEL[s]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">加载中...</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={`无${STATUS_LABEL[statusFilter]}申请`}
          description="骑手入驻申请将在此显示"
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 审核通过确认弹窗（W4-REVIEW P1-3 修复：替代原生 confirm()） */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认通过骑手申请</DialogTitle>
            <DialogDescription>
              {approveTarget?.riderName}（{approveTarget?.phone}）通过后骑手可上线接单
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              取消
            </Button>
            <Button onClick={handleApproveSubmit} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? '提交中...' : '确认通过'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 审核拒绝确认弹窗 */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝骑手申请</DialogTitle>
            <DialogDescription>
              {rejectTarget?.riderName}（{rejectTarget?.phone}）— 请填写拒绝原因
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">拒绝原因</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="例：身份证号无效，请重新提交"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim() || reviewMutation.isPending}
            >
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <StatusBadge status={status} label={STATUS_LABEL[status]} />;
}
