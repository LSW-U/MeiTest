/**
 * 配送调度管理页 — /dispatch（批次 4）
 *
 * 后端：apps/api/src/modules/dispatch/admin-dispatch.controller.ts
 *   - GET    /admin/dispatch/tasks                    任务监控（游标 + filter）
 *   - GET    /admin/dispatch/tasks/:id                详情（含 order + rider）
 *   - POST   /admin/dispatch/tasks/:id/reassign       改派（ASSIGNED only）
 *   - POST   /admin/dispatch/tasks/:id/cancel         取消（PENDING_ASSIGN/ASSIGNED）
 *   - GET    /admin/dispatch/riders/available         可派骑手
 *   - POST   /admin/dispatch/orders/:orderId/recreate 补建
 *
 * 视角：platform（super_admin 写；customer_service 只读，admin-web 不做 role 隐藏，后端 RBAC 兜底）
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { WarehouseLoadPanel } from './warehouse-load-panel';
import { DispatchCenter } from './dispatch-center';
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
import { Loader2 } from 'lucide-react';
import {
  useDispatchTasks,
  useDispatchTaskDetail,
  useAvailableRiders,
  useReassignTask,
  useCancelTask,
  useRecreateTask,
  type AdminDeliveryTask,
  type DeliveryTaskStatus,
} from '@/hooks/api/use-dispatch';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const STATUS_FILTERS: { value: DeliveryTaskStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.dispatch.statusAll' },
  { value: 'PENDING_ASSIGN', labelKey: 'admin.dispatch.statusPendingAssign' },
  { value: 'ASSIGNED', labelKey: 'admin.dispatch.statusAssigned' },
  { value: 'PICKED_UP', labelKey: 'admin.dispatch.statusPickedUp' },
  { value: 'DELIVERING', labelKey: 'admin.dispatch.statusDelivering' },
  { value: 'DELIVERED', labelKey: 'admin.dispatch.statusDelivered' },
  { value: 'FAILED', labelKey: 'admin.dispatch.statusFailed' },
];

export default function DispatchTasksPage() {
  const t = useTranslations('common');
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<DeliveryTaskStatus | 'ALL'>('ALL');
  const [orderNoSearch, setOrderNoSearch] = useState('');
  const [warehouseIdSearch, setWarehouseIdSearch] = useState('');
  // P2-2 接线（2026-09-03）：仓负载预警卡跨仓入口 → 派单中心该仓（nonce 触发 effect）
  const [crossSupportTarget, setCrossSupportTarget] = useState<{ warehouseId: string; nonce: number } | null>(null);
  const [detailTarget, setDetailTarget] = useState<AdminDeliveryTask | null>(null);
  const [reassignTarget, setReassignTarget] = useState<AdminDeliveryTask | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminDeliveryTask | null>(null);
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [recreateOrderId, setRecreateOrderId] = useState('');

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
  const recreateMutation = useRecreateTask();

  const items: AdminDeliveryTask[] = data?.pages.flatMap((p) => p.items) ?? [];

  async function handleRecreateSubmit() {
    if (!recreateOrderId.trim()) return;
    try {
      await recreateMutation.mutateAsync(recreateOrderId.trim());
      toast({ title: t('admin.dispatch.toastRecreateSuccess') });
      setRecreateOpen(false);
      setRecreateOrderId('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.dispatch.toastFailed');
      toast({
        title: t('admin.dispatch.toastFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }

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
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
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
        const canReassign = row.status === 'ASSIGNED';
        const canCancel = row.status === 'PENDING_ASSIGN' || row.status === 'ASSIGNED';
        if (!canReassign && !canCancel) return null;
        return (
          <div className="flex gap-1">
            {canReassign && (
              <Button size="sm" variant="outline" onClick={() => setReassignTarget(row)}>
                {t('admin.dispatch.reassignButton')}
              </Button>
            )}
            {canCancel && (
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
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.dispatch.title')}
        description={t('admin.dispatch.description')}
        action={
          <Button variant="outline" onClick={() => setRecreateOpen(true)}>
            {t('admin.dispatch.recreateButton')}
          </Button>
        }
      />

      {/* ===== 批 E（2026-09-03）：仓库负载面板（方案 Q12）+ 派单中心（方案 Q13） ===== */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('admin.warehouseLoad.title')}</h3>
        {/* P2-2 接线（2026-09-03）：预警卡「跨仓支援」→ 定位派单中心该仓 + 自动开跨仓确认 */}
        <WarehouseLoadPanel onCrossSupport={(warehouseId) => setCrossSupportTarget({ warehouseId, nonce: Date.now() })} />
      </section>

      <section className="space-y-3" id="dispatch-center">
        <h3 className="text-sm font-semibold">{t('admin.dispatchCenter.title')}</h3>
        <DispatchCenter crossSupportTarget={crossSupportTarget} />
      </section>

      {/* ===== 既有：任务监控列表 ===== */}
      <section className="space-y-3">
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
      </section>

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

      {/* 补建任务 Dialog */}
      <Dialog open={recreateOpen} onOpenChange={(open) => !open && setRecreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.dispatch.recreateDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.dispatch.recreateDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="recreate-order-id">
              {t('admin.dispatch.recreateDialogOrderLabel')}
            </Label>
            <Input
              id="recreate-order-id"
              value={recreateOrderId}
              onChange={(e) => setRecreateOrderId(e.target.value)}
              placeholder={t('admin.dispatch.recreateDialogOrderPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecreateOpen(false)}>
              {t('admin.dispatch.commonCancel')}
            </Button>
            <Button
              onClick={handleRecreateSubmit}
              disabled={!recreateOrderId.trim() || recreateMutation.isPending}
            >
              {recreateMutation.isPending
                ? t('loading')
                : t('admin.dispatch.recreateDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
