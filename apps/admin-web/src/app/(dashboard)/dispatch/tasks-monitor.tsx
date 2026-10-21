/**
 * tasks-monitor.tsx — 任务监控组件（从 dispatch/page.tsx 抽离，任务监控独立页批1 20261019）
 *
 * 方案：方案v2-任务监控独立页-20261019.md（§二抽离清单）
 * 抽离范围：STATUS_FILTERS 7 值 Tabs + 搜索框 + DataTable + 加载更多（原 :268-338）
 *           + 详情/改派/取消三个操作 Dialog（原 :340-342，定义 :382-628）
 *           + status 守卫 canReassign/canCancel（原 :217-218，随迁纯函数化供单测）
 *           + 三 target state（原 :102-104，仅监控表格触发，派单中心不共享）
 *
 * 后端：apps/api/src/modules/dispatch/admin-dispatch.controller.ts（零后端改动，hook 全现成）
 * RBAC：读 SUPER_ADMIN+CUSTOMER_SERVICE；写仅 SUPER_ADMIN → 新页 platform-only 视角
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Camera, Loader2 } from 'lucide-react';
import { EvidenceImageGroup } from '@/components/common/evidence-image-group';
import {
  useDispatchTasks,
  useDispatchTaskDetail,
  useAvailableRiders,
  useReassignTask,
  useCancelTask,
  type AdminDeliveryTask,
  type DeliveryTaskStatus,
} from '@/hooks/api/use-dispatch';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export const STATUS_FILTERS: { value: DeliveryTaskStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.dispatch.statusAll' },
  { value: 'PENDING_ASSIGN', labelKey: 'admin.dispatch.statusPendingAssign' },
  { value: 'ASSIGNED', labelKey: 'admin.dispatch.statusAssigned' },
  { value: 'PICKED_UP', labelKey: 'admin.dispatch.statusPickedUp' },
  { value: 'DELIVERING', labelKey: 'admin.dispatch.statusDelivering' },
  { value: 'DELIVERED', labelKey: 'admin.dispatch.statusDelivered' },
  { value: 'FAILED', labelKey: 'admin.dispatch.statusFailed' },
];

/** status 守卫（原 page.tsx:217-218 随迁，纯函数化供单测） */
export function canReassign(status: DeliveryTaskStatus): boolean {
  return status === 'ASSIGNED';
}

/** status 守卫（原 page.tsx:217-218 随迁，纯函数化供单测） */
export function canCancel(status: DeliveryTaskStatus): boolean {
  return status === 'PENDING_ASSIGN' || status === 'ASSIGNED';
}

export function TasksMonitor({
  initialStatus = 'ALL',
  initialWarehouseId = '',
}: {
  /** ?status= 直达初始筛选（仅首挂载默认值，用户手改不锁死） */
  initialStatus?: DeliveryTaskStatus | 'ALL';
  /** ?warehouseId= 初始仓筛选（批1 P3-2：兜底链接透传，仅首挂载默认值） */
  initialWarehouseId?: string;
}) {
  const t = useTranslations('common');
  const [statusFilter, setStatusFilter] = useState<DeliveryTaskStatus | 'ALL'>(initialStatus);
  const [orderNoSearch, setOrderNoSearch] = useState('');
  const [warehouseIdSearch, setWarehouseIdSearch] = useState(initialWarehouseId);
  const [detailTarget, setDetailTarget] = useState<AdminDeliveryTask | null>(null);
  const [reassignTarget, setReassignTarget] = useState<AdminDeliveryTask | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminDeliveryTask | null>(null);

  const {
    data,
    isPending,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDispatchTasks({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    orderNo: orderNoSearch || undefined,
    warehouseId: warehouseIdSearch || undefined,
    limit: 20,
  });

  const items: AdminDeliveryTask[] = data?.pages.flatMap((p) => p.items) ?? [];

  const columns: Column<AdminDeliveryTask>[] = [
    {
      key: 'orderNo',
      header: t('admin.dispatch.columnOrderNo'),
      render: (row) => (
        <button
          onClick={() => setDetailTarget(row)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.order.orderNo}
        </button>
      ),
    },
    {
      key: 'status',
      header: t('admin.dispatch.columnStatus'),
      render: (row) => {
        // 批3 P3-1：窄化取值替代非空断言（守卫与插值同源，后续改守卫不漏类型检查）
        const evidenceCount = row.evidenceUrls?.length ?? 0;
        return (
          <span className="inline-flex items-center gap-1">
            <StatusBadge status={row.status} label={row.status} />
            {/* 批3：有取证照片角标（形态A 拍板；无图不渲染，不加列） */}
            {evidenceCount > 0 && (
              <span
                className="inline-flex items-center text-muted-foreground"
                title={t('admin.dispatch.hasEvidence', { count: evidenceCount })}
                aria-label={t('admin.dispatch.hasEvidence', { count: evidenceCount })}
                data-testid="dispatch-evidence-badge"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'rider',
      header: t('admin.dispatch.columnRider'),
      render: (row) =>
        row.rider ? (
          <span className="text-sm">{row.rider.riderName}</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      key: 'warehouse',
      header: t('admin.dispatch.columnWarehouse'),
      render: (row) => <span className="font-mono text-xs">{row.warehouseCode}</span>,
    },
    {
      key: 'payable',
      header: t('admin.dispatch.columnPayable'),
      render: (row) => (
        <span className="font-mono text-xs">
          {row.order.payableAmount != null ? formatCurrency(row.order.payableAmount) : '-'}
        </span>
      ),
    },
    {
      key: 'assignedAt',
      header: t('admin.dispatch.columnAssignedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.assignedAt ? new Date(row.assignedAt).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => {
        if (!canReassign(row.status) && !canCancel(row.status)) return null;
        return (
          <div className="flex gap-1">
            {canReassign(row.status) && (
              <Button size="sm" variant="outline" onClick={() => setReassignTarget(row)}>
                {t('admin.dispatch.reassignButton')}
              </Button>
            )}
            {canCancel(row.status) && (
              <Button size="sm" variant="destructive" onClick={() => setCancelTarget(row)}>
                {t('admin.dispatch.cancelButton')}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {/* 批1 P3-1（20261020）：恢复原监控区分组标题（PageHeader 与表格之间的语义层，消 monitorTitle 死键） */}
      <h3 className="text-sm font-semibold">{t('admin.dispatch.monitorTitle')}</h3>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as DeliveryTaskStatus | 'ALL')}
        >
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {t(s.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder={t('admin.dispatch.searchOrderNoPlaceholder')}
          value={orderNoSearch}
          onChange={(e) => setOrderNoSearch(e.target.value)}
          className="w-48"
        />
        <Input
          placeholder={t('admin.dispatch.searchWarehousePlaceholder')}
          value={warehouseIdSearch}
          onChange={(e) => setWarehouseIdSearch(e.target.value)}
          className="w-48"
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.dispatch.empty')}
          description={t('admin.dispatch.emptyDescription')}
        />
      ) : (
        <>
          <DataTable data={items} columns={columns} />
          {items.length > 0 && (
            <div className="flex items-center justify-center">
              {hasNextPage ? (
                <Button
                  variant="outline"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('admin.dispatch.loadingMore')}
                    </>
                  ) : (
                    t('admin.dispatch.loadMoreButton')
                  )}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('admin.dispatch.noMore', { count: items.length })}
                </span>
              )}
            </div>
          )}
        </>
      )}

      <TaskDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />
      <ReassignDialog target={reassignTarget} onClose={() => setReassignTarget(null)} />
      <CancelDialog target={cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  );
}

/** 详情 Dialog：拉 detail（含 order + rider + note） */
function TaskDetailDialog({
  target,
  onClose,
}: {
  target: AdminDeliveryTask | null;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const { data, isPending } = useDispatchTaskDetail(target?.id);
  const detail = data ?? target;

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('admin.dispatch.detailDialogTitle')}</DialogTitle>
          <DialogDescription>{detail ? detail.order.orderNo : ''}</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="p-4 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : detail ? (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.dispatch.columnStatus')}:</span>
                <StatusBadge status={detail.status} label={detail.status} />
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('admin.dispatch.columnWarehouse')}:
                </span>{' '}
                <span className="font-mono">{detail.warehouseCode}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('admin.dispatch.columnRider')}:</span>{' '}
                {detail.rider ? detail.rider.riderName : '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('admin.dispatch.columnPayable')}:
                </span>{' '}
                <span className="font-mono">
                  {detail.order.payableAmount != null
                    ? formatCurrency(detail.order.payableAmount)
                    : '-'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('admin.dispatch.detailPickup')}:</span>{' '}
                {detail.pickupAddress}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('admin.dispatch.detailDropoff')}:</span>{' '}
                {detail.dropoffAddress}
              </div>
              {detail.estimatedArrival && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t('admin.dispatch.detailEta')}:</span>{' '}
                  {new Date(detail.estimatedArrival).toLocaleString()}
                </div>
              )}
            </div>
            {detail.note && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">{t('admin.dispatch.detailNote')}</Label>
                <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {detail.note}
                </pre>
              </div>
            )}
            {/* 批1 接入：取证照片（空数组不渲染，方案v2 决策表） */}
            <EvidenceImageGroup urls={detail.evidenceUrls} label={t('admin.dispatch.evidencePhotos')} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** 改派 Dialog（含可派骑手 Select，APPROVED + isOnline 标记） */
function ReassignDialog({
  target,
  onClose,
}: {
  target: AdminDeliveryTask | null;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const { data: riders, isLoading } = useAvailableRiders();
  const mutation = useReassignTask();
  const [newRiderId, setNewRiderId] = useState('');
  const [reason, setReason] = useState('');

  function close() {
    setNewRiderId('');
    setReason('');
    onClose();
  }

  async function handleSubmit() {
    if (!target || !newRiderId) return;
    try {
      await mutation.mutateAsync({
        taskId: target.id,
        newRiderId,
        reason: reason.trim() || undefined,
      });
      toast({ title: t('admin.dispatch.toastReassignSuccess') });
      close();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.dispatch.toastFailed');
      toast({
        title: t('admin.dispatch.toastFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.dispatch.reassignDialogTitle')}</DialogTitle>
          <DialogDescription>
            {target
              ? `${target.order.orderNo} · ${target.rider?.riderName ?? '-'}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t('admin.dispatch.reassignDialogSelectRider')}</Label>
            <Select value={newRiderId} onValueChange={setNewRiderId}>
              <SelectTrigger>
                <SelectValue placeholder={t('admin.dispatch.reassignDialogSelectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {!isLoading &&
                  (riders ?? [])
                    .filter((r) => r.id !== target?.riderId)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.isOnline ? '🟢' : '⚪'} {r.riderName} · {r.totalDeliveries}
                        {t('admin.dispatch.riderDeliveriesSuffix')} · ⭐{r.rating}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reassign-reason">
              {t('admin.dispatch.reassignDialogReasonLabel')}
            </Label>
            <Textarea
              id="reassign-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('admin.dispatch.reassignDialogReasonPlaceholder')}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('admin.dispatch.commonCancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!newRiderId || mutation.isPending}>
            {mutation.isPending ? t('loading') : t('admin.dispatch.reassignDialogConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 取消 Dialog */
function CancelDialog({
  target,
  onClose,
}: {
  target: AdminDeliveryTask | null;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const mutation = useCancelTask();
  const [reason, setReason] = useState('');

  function close() {
    setReason('');
    onClose();
  }

  async function handleSubmit() {
    if (!target) return;
    try {
      await mutation.mutateAsync({
        taskId: target.id,
        reason: reason.trim() || undefined,
      });
      toast({ title: t('admin.dispatch.toastCancelSuccess') });
      close();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.dispatch.toastFailed');
      toast({
        title: t('admin.dispatch.toastFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.dispatch.cancelDialogTitle')}</DialogTitle>
          <DialogDescription>
            {target
              ? `${target.order.orderNo} · ${target.rider?.riderName ?? '-'}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">{t('admin.dispatch.cancelDialogReasonLabel')}</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.dispatch.cancelDialogReasonPlaceholder')}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('admin.dispatch.commonCancel')}
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={mutation.isPending}>
            {t('admin.dispatch.cancelDialogConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
