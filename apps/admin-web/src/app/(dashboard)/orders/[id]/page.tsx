/**
 * 订单详情页 - /orders/[id]
 *
 * 后端：GET /admin/orders/:id（W4 已实现）
 *   - 含 items + events（OrderEvent 时间线）
 *
 * W7-ext-C 升级：
 *   - Confirm 按钮（status=PENDING_CONFIRM -> POST /:id/confirm）
 *   - Pick 按钮（status=CONFIRMED -> POST /:id/pick）
 *   - Edit Dialog（改 remark，调 PATCH /:id）
 *   - Cancel Dialog（已有，保留）
 *   - 全部 i18n 化（移除硬编码 zh）
 */
'use client';

import { useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  useOrderDetail,
  useCancelOrder,
  useConfirmOrder,
  usePickOrder,
  useUpdateOrder,
} from '@/hooks/api/use-orders';
import { OutOfStockDialog } from './out-of-stock-dialog';
import { formatCurrency } from '@/lib/utils';
import type { I18nText } from '@/hooks/api/use-products';

/** 多语言字段取值（fallback 链） */
function displayName(value: I18nText | unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, string>;
    return record.zh ?? record.en ?? record.id ?? record.pt ?? Object.values(record)[0] ?? '';
  }
  return '';
}

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const t = useTranslations('common');
  const format = useFormatter();
  const { toast } = useToast();

  const { data: order, isLoading, error, refetch } = useOrderDetail(id);
  const cancelMutation = useCancelOrder();
  const confirmMutation = useConfirmOrder();
  const pickMutation = usePickOrder();
  const updateMutation = useUpdateOrder();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [remarkInput, setRemarkInput] = useState('');
  const [oosOpen, setOosOpen] = useState(false);

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function handleCancel() {
    cancelMutation.mutate(
      { id, reason: cancelReason },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason('');
          toast({ title: t('admin.orders.toastCancelled') });
          refetch();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.orders.toastFailed');
          toast({ title: t('admin.orders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handleConfirm() {
    confirmMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t('admin.orders.toastConfirmed') });
          refetch();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.orders.toastFailed');
          toast({ title: t('admin.orders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function handlePick() {
    pickMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t('admin.orders.toastPicked') });
          refetch();
        },
        onError: (err) => {
          const message = err instanceof ApiError ? err.message : t('admin.orders.toastFailed');
          toast({ title: t('admin.orders.toastFailed'), description: message, variant: 'destructive' });
        },
      },
    );
  }

  function openEdit() {
    setRemarkInput(order?.remark ?? '');
    setEditOpen(true);
  }

  async function handleSaveRemark() {
    try {
      await updateMutation.mutateAsync({ id, remark: remarkInput.trim() === '' ? null : remarkInput.trim() });
      toast({ title: t('admin.orders.toastUpdated') });
      setEditOpen(false);
      refetch();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.orders.toastFailed');
      toast({ title: t('admin.orders.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">{t('loading')}</div>;
  }

  if (error || !order) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={`${t('admin.orders.title')} #${id.slice(0, 8)}`} />
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  const canCancel = order.status !== 'CANCELLED' && order.status !== 'COMPLETED';
  const canConfirm = order.status === 'PENDING_CONFIRM';
  const canPick = order.status === 'CONFIRMED';
  const canEdit = order.status !== 'CANCELLED' && order.status !== 'COMPLETED';
  // 缺货登记窗口（D7 拣货段）：CONFIRMED/PICKED
  const canReportOos = order.status === 'CONFIRMED' || order.status === 'PICKED';

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={order.orderNo}
        description={`${t('admin.orders.createdAt')}: ${formatDateTime(order.createdAt)}`}
        action={
          canCancel || canConfirm || canPick || canEdit ? (
            <div className="flex flex-wrap gap-2">
              {canReportOos && (
                <Button variant="outline" onClick={() => setOosOpen(true)}>
                  {t('admin.orders.oosDialogTitle')}
                </Button>
              )}
              {canConfirm && (
                <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
                  {confirmMutation.isPending ? t('admin.orders.processing') : t('admin.orders.confirm')}
                </Button>
              )}
              {canPick && (
                <Button onClick={handlePick} disabled={pickMutation.isPending}>
                  {pickMutation.isPending ? t('admin.orders.processing') : t('admin.orders.pick')}
                </Button>
              )}
              {canEdit && (
                <Button variant="outline" onClick={openEdit}>
                  {t('admin.orders.editRemark')}
                </Button>
              )}
              {canCancel && (
                <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                  {t('admin.orders.cancel')}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.orders.statusLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={order.status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.orders.paymentLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <StatusBadge status={order.paymentStatus} />
              <p className="text-xs text-muted-foreground">{order.paymentMethod}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.orders.payableAmount')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-lg font-bold">{formatCurrency(order.payableAmount)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('admin.orders.paidAt')}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-xs text-muted-foreground">
              {order.paidAt ? formatDateTime(order.paidAt) : '-'}
            </span>
          </CardContent>
        </Card>
      </div>

      {order.remark && (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.orders.remarkLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{order.remark}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {t('admin.orders.itemsTitle', { count: order.items.length })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {displayName(item.productName)}
                      {item.outOfStockQty != null && (
                        <span className="ml-2 inline-flex items-center rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                          {t('admin.orders.oosReportedTag')} × {item.outOfStockQty}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {displayName(item.skuName)} × {item.quantity}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs text-muted-foreground">
                      {formatCurrency(item.unitPrice)} × {item.quantity}
                    </p>
                    {/* P3-6（审查 20261024）：金额差展示——unitPrice × outOfStockQty，退款/取消时对账口径 */}
                    {item.outOfStockQty != null && (
                      <p className="font-mono text-xs font-medium text-destructive">
                        {t('admin.orders.oosAmountDelta')}{' '}
                        -{formatCurrency(item.unitPrice * item.outOfStockQty)}
                      </p>
                    )}
                    <p className="font-mono text-sm font-bold">{formatCurrency(item.subtotal)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('admin.orders.amountBreakdown')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('admin.orders.totalAmount')}</span>
                <span className="font-mono">{formatCurrency(order.totalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('admin.orders.deliveryFee')}</span>
                <span className="font-mono">{formatCurrency(order.deliveryFee)}</span>
              </div>
              {order.discountAmount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>
                    {t('admin.orders.discount')}
                    {order.promotion && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        ({order.promotion.code})
                      </span>
                    )}
                  </span>
                  <span className="font-mono">-{formatCurrency(order.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 font-bold">
                <span>{t('admin.orders.payableAmount')}</span>
                <span className="font-mono">{formatCurrency(order.payableAmount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {order.cancelReason && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">{t('admin.orders.cancelReason')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{order.cancelReason}</p>
            {order.cancelledAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('admin.orders.cancelledAt')}: {formatDateTime(order.cancelledAt)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('admin.orders.cancelTitle', { orderNo: order.orderNo })}
            </DialogTitle>
            <DialogDescription>{t('admin.orders.cancelDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">{t('admin.orders.cancelReasonLabel')}</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t('admin.orders.cancelReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={!cancelReason.trim() || cancelMutation.isPending}
            >
              {cancelMutation.isPending ? t('admin.orders.processing') : t('admin.orders.cancelConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Remark Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.orders.editRemarkTitle')}</DialogTitle>
            <DialogDescription>{t('admin.orders.editRemarkDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="remark-input">{t('admin.orders.remarkLabel')}</Label>
            <Textarea
              id="remark-input"
              value={remarkInput}
              onChange={(e) => setRemarkInput(e.target.value)}
              placeholder={t('admin.orders.remarkPlaceholder')}
              rows={4}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {remarkInput.length}/200
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveRemark} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('admin.settings.saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Out of Stock Dialog（缺货履约闭环批1，窗口 CONFIRMED/PICKED） */}
      {canReportOos && (
        <OutOfStockDialog
          open={oosOpen}
          onOpenChange={setOosOpen}
          orderId={id}
          items={order.items}
          onReported={() => refetch()}
        />
      )}
    </div>
  );
}
