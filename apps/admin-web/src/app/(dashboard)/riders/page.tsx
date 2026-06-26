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

export default function RidersListPage() {
  const t = useTranslations();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus>('PENDING');
  const [rejectTarget, setRejectTarget] = useState<RiderApplication | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, error, refetch } = useRiderApplications({
    status: statusFilter,
    limit: 50,
  });
  const reviewMutation = useReviewApplication();

  const items: RiderApplication[] = Array.isArray(data) ? data : [];

  function handleApprove(app: RiderApplication) {
    if (confirm(`确认通过 ${app.riderName} 的骑手申请？`)) {
      reviewMutation.mutate({ id: app.id, input: { action: 'approve' } });
    }
  }

  function handleRejectSubmit() {
    if (!rejectTarget) return;
    reviewMutation.mutate(
      { id: rejectTarget.id, input: { action: 'reject', rejectReason } },
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
      key: 'idCardNumber',
      header: 'ID Card',
      render: (row) => (
        <span className="text-muted-foreground">{row.idCardNumber ?? '—'}</span>
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
      key: 'status',
      header: 'Status',
      render: (row) => <ApplicationStatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'PENDING' ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleApprove(row)}
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
      <PageHeader title={t('nav.riders')} description="骑手入驻审核 + 在线骑手监控" />

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as ApplicationStatus)}>
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === 'PENDING' ? '待审核' : s === 'APPROVED' ? '已通过' : '已拒绝'}
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
          title={`无${statusFilter === 'PENDING' ? '待审核' : statusFilter === 'APPROVED' ? '已通过' : '已拒绝'}申请`}
          description="骑手入驻申请将在此显示"
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

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
  const label =
    status === 'PENDING' ? '待审核' : status === 'APPROVED' ? '已通过' : '已拒绝';
  return <StatusBadge status={status} label={label} />;
}
