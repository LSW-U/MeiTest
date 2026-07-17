/**
 * 骑手管理页 - /riders
 *
 * W7-ext-D 升级（2026-07-10）：
 *   - Select 视图切换器：骑手列表 / 审核申请（和右侧 status 筛选器视觉一致）
 *   - 骑手列表（GET /admin/riders）：6 列 + 4 动作（View / Suspend / Activate / Delete）
 *   - 审核申请（GET /admin/rider-applications）：保留原有 PENDING/APPROVED/REJECTED 三 Tab
 *
 * 后端：
 *   - 已审核骑手：GET /admin/riders + 6 endpoints（详情/编辑/停用/恢复/删除）
 *   - 审核：GET /admin/rider-applications + POST /:id/review
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useToast } from '@/hooks/use-toast';
import {
  useRiderApplications,
  useReviewApplication,
  type RiderApplication,
  type ApplicationStatus,
} from '@/hooks/api/use-riders';
import {
  useAdminRiders,
  useSuspendRider,
  useActivateRider,
  useDeleteRider,
  type AdminRiderListItem,
} from '@/hooks/api/use-admin-riders';
import { ApiError } from '@/lib/api';

const APPLICATION_STATUS_FILTERS: ApplicationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const APPLICATION_STATUS_LABEL_KEY: Record<ApplicationStatus, string> = {
  PENDING: 'admin.riders.statusPending',
  APPROVED: 'admin.riders.statusApproved',
  REJECTED: 'admin.riders.statusRejected',
};

const RIDER_STATUS_FILTERS = ['ALL', 'OFFLINE', 'ONLINE', 'BUSY'] as const;
type RiderStatusFilter = (typeof RIDER_STATUS_FILTERS)[number];

type ViewMode = 'list' | 'applications';

export default function RidersListPage() {
  const t = useTranslations('common');
  const [view, setView] = useState<ViewMode>('list');

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.riders.title')} description={t('admin.riders.description')} />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={view} onValueChange={(v) => setView(v as ViewMode)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="list">{t('admin.riders.viewList')}</SelectItem>
            <SelectItem value="applications">{t('admin.riders.viewApplications')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {view === 'list' ? <RidersListSection /> : <ApplicationsSection />}
    </div>
  );
}

// ===== 骑手列表 Section =====

function RidersListSection() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<RiderStatusFilter>('ALL');
  const [suspendTarget, setSuspendTarget] = useState<AdminRiderListItem | null>(null);
  const [activateTarget, setActivateTarget] = useState<AdminRiderListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRiderListItem | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const params = statusFilter === 'ALL' ? {} : { status: statusFilter as 'OFFLINE' | 'ONLINE' | 'BUSY' };
  const { data, isLoading, error, refetch } = useAdminRiders(params);
  const suspendMutation = useSuspendRider();
  const activateMutation = useActivateRider();
  const deleteMutation = useDeleteRider();

  const items: AdminRiderListItem[] = data ?? [];

  function handleSuspend() {
    if (!suspendTarget) return;
    suspendMutation.mutate(
      { id: suspendTarget.id },
      {
        onSuccess: () => {
          toast({ title: t('admin.riders.toastSuspended') });
          setSuspendTarget(null);
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
          toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handleActivate() {
    if (!activateTarget) return;
    activateMutation.mutate(
      { id: activateTarget.id },
      {
        onSuccess: () => {
          toast({ title: t('admin.riders.toastActivated') });
          setActivateTarget(null);
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
          toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id, reason: deleteReason.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t('admin.riders.toastDeleted') });
          setDeleteTarget(null);
          setDeleteReason('');
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
          toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  const columns: Column<AdminRiderListItem>[] = [
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
          {row.vehicleType}
          {row.vehiclePlate ? ` (${row.vehiclePlate})` : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.riders.columnRiderStatus'),
      render: (row) => (
        <Badge variant={row.status === 'ONLINE' ? 'default' : row.status === 'BUSY' ? 'secondary' : 'outline'}>
          {t(`admin.riders.status${row.status.charAt(0) + row.status.slice(1).toLowerCase()}` as 'admin.riders.statusOffline')}
        </Badge>
      ),
    },
    {
      key: 'totalDeliveries',
      header: t('admin.riders.columnDeliveries'),
      render: (row) => <span className="font-mono text-xs">{row.totalDeliveries}</span>,
    },
    {
      key: 'rating',
      header: t('admin.riders.columnRating'),
      render: (row) => <span className="font-mono text-xs">{row.rating.toFixed(2)}</span>,
    },
    {
      key: 'actions',
      header: t('admin.riders.columnActions'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => router.push(`/riders/${row.id}`)}>
            {t('admin.riders.actionView')}
          </Button>
          {row.status !== 'OFFLINE' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSuspendTarget(row)}
              disabled={suspendMutation.isPending}
            >
              {t('admin.riders.actionSuspend')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setActivateTarget(row)}
            disabled={activateMutation.isPending}
          >
            {t('admin.riders.actionActivate')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDeleteTarget(row);
              setDeleteReason('');
            }}
            disabled={deleteMutation.isPending}
          >
            {t('admin.riders.actionDelete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Select
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as RiderStatusFilter)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RIDER_STATUS_FILTERS.map((s) => (
            <SelectItem key={s} value={s}>
              {s === 'ALL'
                ? t('admin.riders.statusAll')
                : t(`admin.riders.status${s.charAt(0) + s.slice(1).toLowerCase()}` as 'admin.riders.statusOffline')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.riders.emptyListTitle')}
          description={t('admin.riders.emptyListDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 停用确认 */}
      <Dialog open={!!suspendTarget} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.suspendDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.riders.suspendDialogDescription')}
              <span className="font-medium text-foreground">{suspendTarget?.riderName}</span>
              {' '}
              ({suspendTarget?.phone})
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSuspend} disabled={suspendMutation.isPending}>
              {suspendMutation.isPending ? t('loading') : t('admin.riders.actionSuspend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 恢复确认 */}
      <Dialog open={!!activateTarget} onOpenChange={(open) => !open && setActivateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.activateDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.riders.activateDialogDescription')}
              <span className="font-medium text-foreground">{activateTarget?.riderName}</span>
              {' '}
              ({activateTarget?.phone})
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleActivate} disabled={activateMutation.isPending}>
              {activateMutation.isPending ? t('loading') : t('admin.riders.actionActivate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.deleteDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.riders.deleteDialogDescription')}
              <span className="font-medium text-foreground">{deleteTarget?.riderName}</span>
              {' '}
              ({deleteTarget?.phone})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-reason">{t('admin.riders.deleteDialogReasonLabel')}</Label>
            <Textarea
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder={t('admin.riders.deleteDialogReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t('loading') : t('admin.riders.deleteDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ===== 审核申请 Section =====

function ApplicationsSection() {
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
    <>
      <Select
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as ApplicationStatus)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {APPLICATION_STATUS_FILTERS.map((s) => (
            <SelectItem key={s} value={s}>
              {t(APPLICATION_STATUS_LABEL_KEY[s])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.riders.empty', { status: t(APPLICATION_STATUS_LABEL_KEY[statusFilter]) })}
          description={t('admin.riders.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.approveDialogTitle')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{approveTarget?.riderName}</span>
              {' '}
              ({approveTarget?.phone}) - {t('admin.riders.approveDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleApproveSubmit} disabled={reviewMutation.isPending}>
              {reviewMutation.isPending ? t('loading') : t('admin.riders.approveDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.rejectDialogTitle')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{rejectTarget?.riderName}</span>
              {' '}
              ({rejectTarget?.phone}) - {t('admin.riders.rejectDialogDescription')}
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
              {t('cancel')}
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
    </>
  );
}

function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations('common');
  return <StatusBadge status={status} label={t(APPLICATION_STATUS_LABEL_KEY[status])} />;
}
