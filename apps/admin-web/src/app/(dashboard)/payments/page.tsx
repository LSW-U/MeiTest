/**
 * 支付管理页 — /payments（批次 3）
 *
 * 后端：apps/api/src/modules/payment/admin-payment.controller.ts
 *   - GET    /admin/payments                          列表（游标 + join order）
 *   - GET    /admin/payments/:id                      详情（含 order + order.refunds）
 *   - POST   /admin/payments/:orderId/confirm-receipt 确认收款（PAID + Order CONFIRMED 同事务）
 *   - POST   /admin/payments/:orderId/mark-failed     标失败
 *   - GET    /admin/payments/reconciliation           对账汇总
 *
 * 视角：platform（super_admin 写 / customer_service 读）
 */
'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import {
  usePayments,
  usePaymentDetail,
  useConfirmReceipt,
  useMarkFailed,
  useReconciliation,
  type PaymentIntentListItem,
  type PaymentStatus,
  type PaymentMethod,
} from '@/hooks/api/use-payments';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatLocaleDateTime } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const STATUS_FILTERS: { value: PaymentStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.payments.statusAll' },
  { value: 'PENDING', labelKey: 'admin.payments.statusPending' },
  { value: 'PROCESSING', labelKey: 'admin.payments.statusProcessing' },
  { value: 'PAID', labelKey: 'admin.payments.statusPaid' },
  { value: 'FAILED', labelKey: 'admin.payments.statusFailed' },
];

const METHOD_FILTERS: { value: PaymentMethod | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.payments.methodAll' },
  { value: 'COD', labelKey: 'admin.payments.methodCod' },
  { value: 'BANK_TRANSFER', labelKey: 'admin.payments.methodBankTransfer' },
  { value: 'WECHAT', labelKey: 'admin.payments.methodWechat' },
  { value: 'PAYPAL', labelKey: 'admin.payments.methodPaypal' },
  { value: 'STRIPE', labelKey: 'admin.payments.methodStripe' },
];

const METHOD_LABEL_KEY: Record<PaymentMethod, string> = {
  COD: 'admin.payments.methodCod',
  BANK_TRANSFER: 'admin.payments.methodBankTransfer',
  WECHAT: 'admin.payments.methodWechat',
  PAYPAL: 'admin.payments.methodPaypal',
  STRIPE: 'admin.payments.methodStripe',
};

export default function PaymentsListPage() {
  const t = useTranslations('common');
  const locale = useLocale();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'ALL'>('ALL');
  const [orderNoSearch, setOrderNoSearch] = useState('');
  const [detailTarget, setDetailTarget] = useState<PaymentIntentListItem | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PaymentIntentListItem | null>(null);
  const [failTarget, setFailTarget] = useState<PaymentIntentListItem | null>(null);
  const [failReason, setFailReason] = useState('');
  const [showReconciliation, setShowReconciliation] = useState(false);

  const {
    data,
    isPending,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePayments({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    method: methodFilter === 'ALL' ? undefined : methodFilter,
    orderNo: orderNoSearch || undefined,
    limit: 20,
  });
  const confirmMutation = useConfirmReceipt();
  const failMutation = useMarkFailed();

  const items: PaymentIntentListItem[] = data?.pages.flatMap((p) => p.items) ?? [];

  async function handleConfirmSubmit() {
    if (!confirmTarget) return;
    try {
      await confirmMutation.mutateAsync(confirmTarget.orderId);
      toast({ title: t('admin.payments.toastConfirmSuccess') });
      setConfirmTarget(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.payments.toastFailed');
      toast({
        title: t('admin.payments.toastFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }

  async function handleMarkFailedSubmit() {
    if (!failTarget || !failReason.trim()) return;
    try {
      await failMutation.mutateAsync({ orderId: failTarget.orderId, reason: failReason.trim() });
      toast({ title: t('admin.payments.toastMarkFailedSuccess') });
      setFailTarget(null);
      setFailReason('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.payments.toastFailed');
      toast({
        title: t('admin.payments.toastFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }

  const columns: Column<PaymentIntentListItem>[] = [
    {
      key: 'orderNo',
      header: t('admin.payments.columnOrderNo'),
      render: (row) => (
        <button
          onClick={() => setDetailTarget(row)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.orderNo}
        </button>
      ),
    },
    {
      key: 'method',
      header: t('admin.payments.columnMethod'),
      render: (row) => <span className="text-sm">{t(METHOD_LABEL_KEY[row.method])}</span>,
    },
    {
      key: 'status',
      header: t('admin.payments.columnStatus'),
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
    },
    {
      key: 'amount',
      header: t('admin.payments.columnAmount'),
      render: (row) => <span className="font-mono text-xs">{formatCurrency(row.amount)}</span>,
    },
    {
      key: 'mockFlag',
      header: t('admin.payments.columnMockFlag'),
      render: (row) => (
        <span
          className={`text-xs ${row.mockFlag ? 'text-amber-600' : 'text-muted-foreground'}`}
        >
          {row.mockFlag ? t('admin.payments.mockFlagTrue') : t('admin.payments.mockFlagFalse')}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.payments.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatLocaleDateTime(row.createdAt, locale)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => {
        const canAct = row.status === 'PROCESSING' || row.status === 'PENDING';
        if (!canAct) return null;
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              onClick={() => setConfirmTarget(row)}
              disabled={confirmMutation.isPending}
            >
              {t('admin.payments.confirmButton')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setFailTarget(row);
                setFailReason('');
              }}
              disabled={failMutation.isPending}
            >
              {t('admin.payments.markFailedButton')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.payments.title')}
        description={t('admin.payments.description')}
        action={
          <Button variant="outline" onClick={() => setShowReconciliation((v) => !v)}>
            {t('admin.payments.reconciliationTitle')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PaymentStatus | 'ALL')}
        >
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {t(s.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={methodFilter}
          onValueChange={(v) => setMethodFilter(v as PaymentMethod | 'ALL')}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHOD_FILTERS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {t(m.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder={t('admin.payments.searchOrderNoPlaceholder')}
          value={orderNoSearch}
          onChange={(e) => setOrderNoSearch(e.target.value)}
          className="w-56"
        />
      </div>

      {showReconciliation && <ReconciliationCard />}

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.payments.empty')}
          description={t('admin.payments.emptyDescription')}
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
                      {t('admin.payments.loadingMore')}
                    </>
                  ) : (
                    t('admin.payments.loadMoreButton')
                  )}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('admin.payments.noMore', { count: items.length })}
                </span>
              )}
            </div>
          )}
        </>
      )}

      <PaymentDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />

      {/* 确认收款 Dialog */}
      <Dialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.payments.confirmDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.payments.confirmDialogDescription', {
                orderNo: confirmTarget?.orderNo ?? '',
                amount: confirmTarget ? formatCurrency(confirmTarget.amount) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              {t('admin.payments.commonCancel')}
            </Button>
            <Button onClick={handleConfirmSubmit} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending
                ? t('loading')
                : t('admin.payments.confirmDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 标失败 Dialog */}
      <Dialog open={!!failTarget} onOpenChange={(open) => !open && setFailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.payments.markFailedDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.payments.markFailedDialogDescription', {
                orderNo: failTarget?.orderNo ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fail-reason">
              {t('admin.payments.markFailedDialogReasonLabel')}
            </Label>
            <Textarea
              id="fail-reason"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder={t('admin.payments.markFailedDialogReasonPlaceholder')}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailTarget(null)}>
              {t('admin.payments.commonCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleMarkFailedSubmit}
              disabled={!failReason.trim() || failMutation.isPending}
            >
              {t('admin.payments.markFailedDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 详情 Dialog：拉取 detail（含 order + refunds） */
function PaymentDetailDialog({
  target,
  onClose,
}: {
  target: PaymentIntentListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const { data, isPending } = usePaymentDetail(target?.id);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('admin.payments.detailDialogTitle')}</DialogTitle>
          <DialogDescription>
            {target ? `${target.orderNo} · ${t(METHOD_LABEL_KEY[target.method])}` : ''}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="p-4 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : data ? (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {t('admin.payments.columnStatus')}:
                </span>
                <StatusBadge status={data.status} label={data.status} />
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('admin.payments.columnAmount')}:
                </span>{' '}
                <span className="font-mono">{formatCurrency(data.amount)}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">
                  {t('admin.payments.detailOrderStatus')}:
                </span>{' '}
                <span className="font-mono">{data.order.status}</span>
              </div>
              {data.transactionId && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">transactionId:</span>{' '}
                  <span className="font-mono text-xs">{data.transactionId}</span>
                </div>
              )}
              {data.receiptUrl && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">receipt:</span>{' '}
                  <a
                    href={data.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    {data.receiptUrl.slice(0, 50)}...
                  </a>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">{t('admin.payments.detailRefunds')}</Label>
              {data.order.refunds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('admin.payments.detailNoRefunds')}
                </p>
              ) : (
                <div className="space-y-1">
                  {data.order.refunds.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between border-b pb-1 text-xs last:border-0"
                    >
                      <span className="font-mono">{r.reason}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{formatCurrency(r.amount)}</span>
                        <StatusBadge status={r.status} label={r.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** 对账汇总 Card */
function ReconciliationCard() {
  const t = useTranslations('common');
  const { data, isLoading } = useReconciliation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('admin.payments.reconciliationTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : data && data.length > 0 ? (
          <div className="space-y-1">
            {data.map((r, i) => (
              <div
                key={`${r.status}-${r.method}-${i}`}
                className="flex items-center justify-between border-b pb-1 text-xs last:border-0"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} label={r.status} />
                  <span className="text-muted-foreground">{r.method}</span>
                </div>
                <div className="flex items-center gap-3 font-mono">
                  <span>
                    {t('admin.payments.reconciliationCount', { count: r.count })}
                  </span>
                  <span>{formatCurrency(r.totalAmount)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('admin.payments.empty')}</p>
        )}
      </CardContent>
    </Card>
  );
}
