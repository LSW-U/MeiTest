/**
 * 保证金申请处理页 — /riders/deposit-requests（批 E，2026-09-03）
 *
 * 后端：GET /admin/deposit/requests?status=&page= + POST /:id/confirm|reject
 *
 * 裁决落地（批 B 审查 P3-2）：
 *   - 确认收款按钮对 ONLINE_MOCK 通道**不显示**（线上走骑手端 pay-mock 即时生效，
 *     admin 双确认入口按拍板用前端过滤关闭）
 *   - OFFLINE_COD PENDING：确认可修改 confirmedAmount（提示「线下实收可能≠申请额」）
 *     + adminNote；拒绝 adminNote 必填
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
import { Badge } from '@/components/ui/badge';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useDepositRequests,
  useConfirmDepositRequest,
  useRejectDepositRequest,
  type RiderDepositRequestItem,
} from '@/hooks/api/use-deposit';
import { formatCurrency } from '@/lib/utils';
import { ApiError } from '@/lib/api';

type StatusFilter = 'ALL' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED';

const PAGE_SIZE = 20;

export default function DepositRequestsPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [page, setPage] = useState(1);

  const { data, isPending, isError, refetch } = useDepositRequests({
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const confirmMutation = useConfirmDepositRequest();
  const rejectMutation = useRejectDepositRequest();

  // 确认 Dialog（预填申请额，可修改）
  const [confirming, setConfirming] = useState<RiderDepositRequestItem | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirmNote, setConfirmNote] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 拒绝 Dialog（adminNote 必填）
  const [rejecting, setRejecting] = useState<RiderDepositRequestItem | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  function openConfirm(req: RiderDepositRequestItem) {
    setConfirming(req);
    setConfirmAmount((req.requestedAmount / 100).toString());
    setConfirmNote('');
    setConfirmError(null);
  }

  async function handleConfirm() {
    if (!confirming) return;
    const amountDollar = Number(confirmAmount);
    if (!Number.isFinite(amountDollar) || amountDollar < 1) {
      setConfirmError(t('admin.deposit.requests.errorAmount'));
      return;
    }
    setConfirmError(null);
    try {
      const cents = Math.round(amountDollar * 100);
      await confirmMutation.mutateAsync({
        id: confirming.id,
        confirmedAmount: cents === confirming.requestedAmount ? undefined : cents,
        adminNote: confirmNote.trim() || undefined,
      });
      toast({ description: t('admin.deposit.requests.toastConfirmed') });
      setConfirming(null);
    } catch (e) {
      setConfirmError(e instanceof ApiError ? e.message : t('common.error.generic'));
    }
  }

  async function handleReject() {
    if (!rejecting) return;
    if (!rejectNote.trim()) {
      setRejectError(t('admin.deposit.requests.errorRejectNoteRequired'));
      return;
    }
    setRejectError(null);
    try {
      await rejectMutation.mutateAsync({ id: rejecting.id, adminNote: rejectNote.trim() });
      toast({ description: t('admin.deposit.requests.toastRejected') });
      setRejecting(null);
    } catch (e) {
      setRejectError(e instanceof ApiError ? e.message : t('common.error.generic'));
    }
  }

  const columns: Column<RiderDepositRequestItem>[] = [
    {
      key: 'rider',
      header: t('admin.deposit.requests.columnRider'),
      render: (req) => (
        <div>
          <div className="font-medium">{req.riderName}</div>
          <div className="text-xs text-muted-foreground">{req.riderPhone}</div>
        </div>
      ),
    },
    {
      key: 'channel',
      header: t('admin.deposit.requests.columnChannel'),
      render: (req) =>
        req.channel === 'OFFLINE_COD' ? (
          t('admin.deposit.requests.channelCod')
        ) : (
          <Badge variant="secondary">{t('admin.deposit.requests.channelOnline')}</Badge>
        ),
    },
    {
      key: 'amount',
      header: t('admin.deposit.requests.columnAmount'),
      render: (req) => (
        <div>
          <div>{formatCurrency(req.requestedAmount)}</div>
          {req.status === 'CONFIRMED' && req.confirmedAmount !== req.requestedAmount && (
            <div className="text-xs text-muted-foreground">
              {t('admin.deposit.requests.confirmedAs', { amount: formatCurrency(req.confirmedAmount) })}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: t('admin.deposit.requests.columnLocation'),
      render: (req) => req.locationName ?? '—',
    },
    {
      key: 'note',
      header: t('admin.deposit.requests.columnNote'),
      render: (req) => (
        <div className="max-w-[200px] truncate" title={req.note ?? ''}>
          {req.note ?? '—'}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.deposit.requests.columnStatus'),
      render: (req) => (
        <div className="space-y-1">
          <StatusBadge status={req.status === 'PENDING' ? 'PENDING' : req.status === 'CONFIRMED' ? 'ACTIVE' : 'REJECTED'}
            label={t(`admin.deposit.requests.status${req.status.charAt(0)}${req.status.slice(1).toLowerCase()}`)} />
          {req.status === 'CONFIRMED' && req.confirmedAt && (
            <div className="text-xs text-muted-foreground">
              {new Date(req.confirmedAt).toLocaleString()}
            </div>
          )}
          {req.adminNote && (
            <div className="text-xs text-muted-foreground" title={req.adminNote}>
              {t('admin.deposit.requests.adminNotePrefix')}{req.adminNote}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('admin.deposit.requests.columnActions'),
      render: (req) =>
        req.status === 'PENDING' ? (
          <div className="flex gap-2">
            {/* 裁决 P3-2：ONLINE_MOCK 不显示确认按钮（线上即时生效，admin 双入口关闭） */}
            {req.channel === 'OFFLINE_COD' && (
              <Button size="sm" onClick={() => openConfirm(req)}>
                <Check className="mr-1 h-3 w-3" />
                {t('admin.deposit.requests.actionConfirm')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setRejecting(req); setRejectNote(''); setRejectError(null); }}>
              <X className="mr-1 h-3 w-3" />
              {t('admin.deposit.requests.actionReject')}
            </Button>
          </div>
        ) : (
          '—'
        ),
    },
  ];

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.deposit.requests.title')}
        description={t('admin.deposit.requests.description')}
      />

      <div className="flex items-center gap-3">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">{t('admin.deposit.requests.statusPending')}</SelectItem>
            <SelectItem value="CONFIRMED">{t('admin.deposit.requests.statusConfirmed')}</SelectItem>
            <SelectItem value="REJECTED">{t('admin.deposit.requests.statusRejected')}</SelectItem>
            <SelectItem value="REFUNDED">{t('admin.deposit.requests.statusRefunded')}</SelectItem>
            <SelectItem value="ALL">{t('admin.deposit.requests.statusAll')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('admin.deposit.requests.emptyTitle')} description={t('admin.deposit.requests.emptyDescription')} />
      ) : (
        <>
          <DataTable columns={columns} data={data.items} />
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('admin.deposit.requests.prevPage')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                {t('admin.deposit.requests.nextPage')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* 确认收款 Dialog（可修改实收金额） */}
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.deposit.requests.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.deposit.requests.confirmDescription', {
                rider: confirming?.riderName ?? '',
                amount: formatCurrency(confirming?.requestedAmount ?? 0),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-amount">{t('admin.deposit.requests.confirmedAmountLabel')}</Label>
              <Input
                id="confirm-amount"
                type="number"
                min={1}
                step="0.01"
                value={confirmAmount}
                onChange={(e) => setConfirmAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('admin.deposit.requests.amountHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-note">{t('admin.deposit.requests.adminNoteLabel')}</Label>
              <Textarea
                id="confirm-note"
                value={confirmNote}
                onChange={(e) => setConfirmNote(e.target.value)}
                rows={2}
              />
            </div>
            {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('admin.deposit.requests.actionConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝 Dialog（adminNote 必填） */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.deposit.requests.rejectTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.deposit.requests.rejectDescription', { rider: rejecting?.riderName ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-note">{t('admin.deposit.requests.adminNoteLabel')}</Label>
              <Textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={3}
                placeholder={t('admin.deposit.requests.rejectNotePlaceholder')}
              />
            </div>
            {rejectError && <p className="text-sm text-destructive">{rejectError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejectMutation.isPending}>
              {rejectMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('admin.deposit.requests.actionReject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
