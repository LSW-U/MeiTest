/**
 * 骑手详情页 - /riders/[id]
 *
 * W7-ext-D 实现（2026-07-10）
 * 后端：GET /admin/riders/:id（含 User 状态 + 最近 10 订单）
 *
 * 动作：
 *   - Edit（vehicleType/vehiclePlate/preferredWarehouseIds）
 *   - Suspend / Activate
 *   - Delete
 */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useToast } from '@/hooks/use-toast';
import {
  useAdminRiderDetail,
  useUpdateAdminRider,
  useSuspendRider,
  useActivateRider,
  useDeleteRider,
  type UpdateAdminRiderInput,
} from '@/hooks/api/use-admin-riders';
import { formatCurrency } from '@/lib/utils';

const VEHICLE_TYPES = ['MOTORCYCLE', 'BICYCLE', 'CAR'] as const;

export default function RiderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const t = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();

  const { data: rider, isLoading, error, refetch } = useAdminRiderDetail(id);
  const updateMutation = useUpdateAdminRider();
  const suspendMutation = useSuspendRider();
  const activateMutation = useActivateRider();
  const deleteMutation = useDeleteRider();

  const [editOpen, setEditOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  // Edit form state
  const [vehicleType, setVehicleType] = useState<'MOTORCYCLE' | 'BICYCLE' | 'CAR'>('MOTORCYCLE');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [preferredWarehouseIdsText, setPreferredWarehouseIdsText] = useState('');

  useEffect(() => {
    if (rider) {
      setVehicleType(rider.vehicleType);
      setVehiclePlate(rider.vehiclePlate ?? '');
      setPreferredWarehouseIdsText(rider.preferredWarehouseIds.join('\n'));
    }
  }, [rider]);

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function parseWarehouseIds(text: string): string[] {
    return text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function handleSaveEdit() {
    if (!rider) return;
    const input: UpdateAdminRiderInput = {
      vehicleType,
      vehiclePlate: vehiclePlate.trim() === '' ? null : vehiclePlate.trim(),
      preferredWarehouseIds: parseWarehouseIds(preferredWarehouseIdsText),
    };
    try {
      await updateMutation.mutateAsync({ id: rider.id, input });
      toast({ title: t('admin.riders.toastUpdated') });
      setEditOpen(false);
      refetch();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
      toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  function handleSuspend() {
    if (!rider) return;
    suspendMutation.mutate(
      { id: rider.id },
      {
        onSuccess: () => {
          toast({ title: t('admin.riders.toastSuspended') });
          setSuspendOpen(false);
          refetch();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
          toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handleActivate() {
    if (!rider) return;
    activateMutation.mutate(
      { id: rider.id },
      {
        onSuccess: () => {
          toast({ title: t('admin.riders.toastActivated') });
          setActivateOpen(false);
          refetch();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
          toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handleDelete() {
    if (!rider) return;
    deleteMutation.mutate(
      { id: rider.id, reason: deleteReason.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t('admin.riders.toastDeleted') });
          router.push('/riders');
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.riders.toastFailed');
          toast({ title: t('admin.riders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">{t('loading')}</div>;
  }

  if (error || !rider) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t('admin.riders.title')} />
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  const isDeleted = rider.userStatus === 'DELETED';
  const isSuspended = rider.userStatus === 'SUSPENDED';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={rider.riderName}
        description={`${t('admin.riders.columnPhone')}: ${rider.phone}`}
        action={
          !isDeleted ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                {t('admin.riders.actionEdit')}
              </Button>
              {!isSuspended && (
                <Button
                  variant="outline"
                  onClick={() => setSuspendOpen(true)}
                  disabled={suspendMutation.isPending}
                >
                  {t('admin.riders.actionSuspend')}
                </Button>
              )}
              {isSuspended && (
                <Button
                  onClick={() => setActivateOpen(true)}
                  disabled={activateMutation.isPending}
                >
                  {t('admin.riders.actionActivate')}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                {t('admin.riders.actionDelete')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.riders.columnRiderStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={rider.status === 'ONLINE' ? 'default' : rider.status === 'BUSY' ? 'secondary' : 'outline'}>
              {t(`admin.riders.status${rider.status.charAt(0) + rider.status.slice(1).toLowerCase()}` as 'admin.riders.statusOffline')}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.riders.columnUserStatus')}</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge
              status={rider.userStatus}
              label={t(`admin.riders.userStatus${rider.userStatus}` as 'admin.riders.userStatusACTIVE')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.riders.columnDeliveries')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{rider.totalDeliveries}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.riders.columnRating')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{rider.rating.toFixed(2)}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.riders.vehicleInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('admin.riders.columnVehicle')}</span>
              <span>{rider.vehicleType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('admin.riders.vehiclePlate')}</span>
              <span className="font-mono">{rider.vehiclePlate ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('admin.riders.idCardNumber')}</span>
              <span className="font-mono text-xs">{rider.idCardNumber ?? '-'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin.riders.preferredWarehouses')}</CardTitle>
          </CardHeader>
          <CardContent>
            {rider.preferredWarehouseIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.riders.noPreferredWarehouses')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {rider.preferredWarehouseIds.map((whId) => (
                  <Badge key={whId} variant="outline" className="font-mono text-xs">
                    {whId}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 最近订单 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.riders.recentOrdersTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {rider.recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.riders.noRecentOrders')}</p>
          ) : (
            <div className="space-y-2">
              {rider.recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <p className="font-mono text-sm font-medium">{order.orderNo}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={order.status} />
                    <span className="font-mono text-sm">{formatCurrency(order.payableAmount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.editDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.riders.editDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="vehicleType">{t('admin.riders.columnVehicle')}</Label>
              <Select value={vehicleType} onValueChange={(v) => setVehicleType(v as 'MOTORCYCLE' | 'BICYCLE' | 'CAR')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehiclePlate">{t('admin.riders.vehiclePlate')}</Label>
              <Input
                id="vehiclePlate"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="TD-001"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preferredWarehouseIds">{t('admin.riders.preferredWarehouses')}</Label>
              <Textarea
                id="preferredWarehouseIds"
                value={preferredWarehouseIdsText}
                onChange={(e) => setPreferredWarehouseIdsText(e.target.value)}
                placeholder={t('admin.riders.preferredWarehousesPlaceholder')}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {t('admin.riders.preferredWarehousesHint')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('admin.settings.saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.suspendDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.riders.suspendDialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSuspend} disabled={suspendMutation.isPending}>
              {suspendMutation.isPending ? t('loading') : t('admin.riders.actionSuspend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate Dialog */}
      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.activateDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.riders.activateDialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleActivate} disabled={activateMutation.isPending}>
              {activateMutation.isPending ? t('loading') : t('admin.riders.actionActivate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.riders.deleteDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.riders.deleteDialogDescription')}</DialogDescription>
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
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
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
    </div>
  );
}
