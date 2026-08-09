/**
 * 提现审核页 — /withdrawals
 *
 * 后端：
 *   - GET  /admin/settle/withdrawals              列表（offset 分页）
 *   - POST /admin/settle/withdrawals              创建（super_admin 代录）
 *   - POST /admin/settle/withdrawals/:id/review   审核（APPROVE/REJECT）
 *   - POST /admin/settle/withdrawals/:id/mark-paid 标记线下打款完成
 *
 * 视角：platform（super_admin 写；warehouse_staff/customer_service 只读，admin-web 不做 role 隐藏，后端 RBAC 兜底）
 * 状态机：PENDING → APPROVED → PAID / PENDING → REJECTED / APPROVED → FAILED
 * 金额字段单位「分」，前端 formatCurrency 转元展示；Create Dialog 输入元提交 ×100 转分
 */
'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useWithdrawals,
  useReviewWithdrawal,
  useMarkPaidWithdrawal,
  useCreateWithdrawal,
  type Withdrawal,
  type WithdrawalStatus,
  type WithdrawalRequesterType,
  type PayoutChannel,
  type PayoutAccount,
} from '@/hooks/api/use-withdrawals';
import { formatCurrency } from '@/lib/utils';
import { ApiError } from '@/lib/api';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: WithdrawalStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.withdrawals.statusAll' },
  { value: 'PENDING', labelKey: 'admin.withdrawals.statusPending' },
  { value: 'APPROVED', labelKey: 'admin.withdrawals.statusApproved' },
  { value: 'REJECTED', labelKey: 'admin.withdrawals.statusRejected' },
  { value: 'PAID', labelKey: 'admin.withdrawals.statusPaid' },
  { value: 'FAILED', labelKey: 'admin.withdrawals.statusFailed' },
];

const REQUESTER_TYPE_LABEL_KEY: Record<WithdrawalRequesterType, string> = {
  MERCHANT: 'admin.withdrawals.requesterMerchant',
  RIDER: 'admin.withdrawals.requesterRider',
};

const CHANNEL_LABEL_KEY: Record<PayoutChannel, string> = {
  BANK_TRANSFER: 'admin.withdrawals.channelBankTransfer',
  WECHAT: 'admin.withdrawals.channelWechat',
  ALIPAY: 'admin.withdrawals.channelAlipay',
  PAYPAL: 'admin.withdrawals.channelPaypal',
};

export default function WithdrawalsListPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<WithdrawalStatus | 'ALL'>('PENDING');
  const [requesterTypeFilter, setRequesterTypeFilter] = useState<
    WithdrawalRequesterType | 'ALL'
  >('ALL');
  const [page, setPage] = useState(1);

  // 审核 Dialog
  const [reviewTarget, setReviewTarget] = useState<Withdrawal | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [rejectReason, setRejectReason] = useState('');

  // 标记已打款 Dialog
  const [markPaidTarget, setMarkPaidTarget] = useState<Withdrawal | null>(null);
  const [payoutReference, setPayoutReference] = useState('');

  // 创建提现 Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createRequesterType, setCreateRequesterType] = useState<WithdrawalRequesterType>('RIDER');
  const [createRequesterId, setCreateRequesterId] = useState('');
  const [createAmountYuan, setCreateAmountYuan] = useState('');
  const [createChannel, setCreateChannel] = useState<PayoutChannel>('BANK_TRANSFER');
  const [createAccount, setCreateAccount] = useState('');
  const [createHolderName, setCreateHolderName] = useState('');
  const [createBankName, setCreateBankName] = useState('');
  const [createBranchName, setCreateBranchName] = useState('');

  // 切筛选回第 1 页
  useEffect(() => {
    setPage(1);
  }, [statusFilter, requesterTypeFilter]);

  const { data, isPending, isFetching, error, refetch } = useWithdrawals({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    requesterType: requesterTypeFilter === 'ALL' ? undefined : requesterTypeFilter,
    page,
    pageSize: PAGE_SIZE,
  });
  const reviewMutation = useReviewWithdrawal();
  const markPaidMutation = useMarkPaidWithdrawal();
  const createMutation = useCreateWithdrawal();

  const items: Withdrawal[] = data?.items ?? [];
  const isLoading = isPending || isFetching;
  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  function openReviewDialog(w: Withdrawal) {
    setReviewTarget(w);
    setReviewAction('APPROVE');
    setRejectReason('');
  }

  async function handleReviewSubmit() {
    if (!reviewTarget) return;
    try {
      await reviewMutation.mutateAsync({
        id: reviewTarget.id,
        input: {
          action: reviewAction,
          ...(reviewAction === 'REJECT' && rejectReason.trim() ? { rejectReason: rejectReason.trim() } : {}),
        },
      });
      toast({
        title:
          reviewAction === 'APPROVE'
            ? t('admin.withdrawals.toastApproved')
            : t('admin.withdrawals.toastRejected'),
      });
      setReviewTarget(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.withdrawals.toastFailed');
      toast({ title: t('admin.withdrawals.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  async function handleMarkPaidSubmit() {
    if (!markPaidTarget) return;
    try {
      await markPaidMutation.mutateAsync({
        id: markPaidTarget.id,
        input: { payoutReference: payoutReference.trim() },
      });
      toast({ title: t('admin.withdrawals.toastMarkedPaid') });
      setMarkPaidTarget(null);
      setPayoutReference('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.withdrawals.toastFailed');
      toast({ title: t('admin.withdrawals.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  async function handleCreateSubmit() {
    const amountYuan = parseFloat(createAmountYuan);
    if (isNaN(amountYuan) || amountYuan <= 0) {
      toast({ title: t('admin.withdrawals.toastFailed'), description: t('admin.withdrawals.createAmountInvalid'), variant: 'destructive' });
      return;
    }
    const payoutAccount: PayoutAccount = {
      channel: createChannel,
      account: createAccount.trim(),
      ...(createHolderName.trim() ? { holderName: createHolderName.trim() } : {}),
      ...(createChannel === 'BANK_TRANSFER' && createBankName.trim()
        ? { bankName: createBankName.trim() }
        : {}),
      ...(createChannel === 'BANK_TRANSFER' && createBranchName.trim()
        ? { branchName: createBranchName.trim() }
        : {}),
    };
    try {
      await createMutation.mutateAsync({
        requesterType: createRequesterType,
        requesterId: createRequesterId.trim(),
        amount: Math.round(amountYuan * 100),
        payoutAccount,
      });
      toast({ title: t('admin.withdrawals.toastCreated') });
      setCreateOpen(false);
      setCreateRequesterId('');
      setCreateAmountYuan('');
      setCreateAccount('');
      setCreateHolderName('');
      setCreateBankName('');
      setCreateBranchName('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.withdrawals.toastFailed');
      toast({ title: t('admin.withdrawals.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  const columns: Column<Withdrawal>[] = [
    {
      key: 'requester',
      header: t('admin.withdrawals.columnRequester'),
      render: (row) => (
        <div className="space-y-0.5">
          <span className="text-sm font-medium">{t(REQUESTER_TYPE_LABEL_KEY[row.requesterType])}</span>
          <p className="text-xs text-muted-foreground font-mono">{row.requesterId}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('admin.withdrawals.columnAmount'),
      render: (row) => (
        <span className="font-mono text-sm font-bold text-primary">{formatCurrency(row.amount)}</span>
      ),
    },
    {
      key: 'payoutAccount',
      header: t('admin.withdrawals.columnPayoutAccount'),
      render: (row) => (
        <div className="space-y-0.5">
          <span className="text-xs font-medium">{t(CHANNEL_LABEL_KEY[row.payoutAccount.channel])}</span>
          <p className="text-xs text-muted-foreground font-mono">{row.payoutAccount.account}</p>
          {row.payoutAccount.holderName && (
            <p className="text-xs text-muted-foreground">{row.payoutAccount.holderName}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.withdrawals.columnStatus'),
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
    },
    {
      key: 'createdAt',
      header: t('admin.withdrawals.columnAppliedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => {
        if (row.status === 'PENDING') {
          return (
            <Button size="sm" onClick={() => openReviewDialog(row)} disabled={reviewMutation.isPending}>
              {t('admin.withdrawals.reviewButton')}
            </Button>
          );
        }
        if (row.status === 'APPROVED') {
          return (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setMarkPaidTarget(row);
                setPayoutReference('');
              }}
              disabled={markPaidMutation.isPending}
            >
              {t('admin.withdrawals.markPaidButton')}
            </Button>
          );
        }
        if (row.payoutReference) {
          return (
            <span className="font-mono text-xs text-muted-foreground" title={row.payoutReference}>
              {row.payoutReference.slice(0, 16)}...
            </span>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.withdrawals.title')}
        description={t('admin.withdrawals.description')}
        action={
          <Button onClick={() => setCreateOpen(true)}>{t('admin.withdrawals.createButton')}</Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as WithdrawalStatus | 'ALL')}
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
          value={requesterTypeFilter}
          onValueChange={(v) => setRequesterTypeFilter(v as WithdrawalRequesterType | 'ALL')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t('admin.withdrawals.requesterAll')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('admin.withdrawals.requesterAll')}</SelectItem>
            <SelectItem value="MERCHANT">{t('admin.withdrawals.requesterMerchant')}</SelectItem>
            <SelectItem value="RIDER">{t('admin.withdrawals.requesterRider')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.withdrawals.empty')}
          description={t('admin.withdrawals.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 分页器 */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t('admin.withdrawals.pageInfo', {
              page,
              total: Math.ceil(total / PAGE_SIZE),
              totalItems: total,
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('admin.withdrawals.prevPage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
            >
              {t('admin.withdrawals.nextPage')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 审核 Dialog（APPROVE/REJECT，REJECT 必填 rejectReason） */}
      <Dialog open={!!reviewTarget} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.withdrawals.reviewDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.withdrawals.reviewDialogDescription', {
                amount: reviewTarget ? formatCurrency(reviewTarget.amount) : '',
                requester:
                  reviewTarget ? t(REQUESTER_TYPE_LABEL_KEY[reviewTarget.requesterType]) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('admin.withdrawals.reviewActionLabel')}</Label>
              <Select
                value={reviewAction}
                onValueChange={(v) => setReviewAction(v as 'APPROVE' | 'REJECT')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVE">{t('admin.withdrawals.actionApprove')}</SelectItem>
                  <SelectItem value="REJECT">{t('admin.withdrawals.actionReject')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reviewAction === 'REJECT' && (
              <div className="space-y-2">
                <Label htmlFor="reject-reason">{t('admin.withdrawals.rejectReasonLabel')}</Label>
                <Textarea
                  id="reject-reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t('admin.withdrawals.rejectReasonPlaceholder')}
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>
              {t('admin.withdrawals.reviewDialogCancel')}
            </Button>
            <Button
              variant={reviewAction === 'REJECT' ? 'destructive' : 'default'}
              onClick={handleReviewSubmit}
              disabled={reviewAction === 'REJECT' ? !rejectReason.trim() || reviewMutation.isPending : reviewMutation.isPending}
            >
              {reviewMutation.isPending ? t('loading') : t('admin.withdrawals.reviewDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 标记已打款 Dialog */}
      <Dialog open={!!markPaidTarget} onOpenChange={(open) => !open && setMarkPaidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.withdrawals.markPaidDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.withdrawals.markPaidDialogDescription', {
                amount: markPaidTarget ? formatCurrency(markPaidTarget.amount) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payout-ref">{t('admin.withdrawals.payoutReferenceLabel')}</Label>
            <Input
              id="payout-ref"
              value={payoutReference}
              onChange={(e) => setPayoutReference(e.target.value)}
              placeholder={t('admin.withdrawals.payoutReferencePlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidTarget(null)}>
              {t('admin.withdrawals.markPaidDialogCancel')}
            </Button>
            <Button
              onClick={handleMarkPaidSubmit}
              disabled={!payoutReference.trim() || markPaidMutation.isPending}
            >
              {markPaidMutation.isPending ? t('loading') : t('admin.withdrawals.markPaidDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 创建提现 Dialog（super_admin 代录） */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('admin.withdrawals.createDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.withdrawals.createDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('admin.withdrawals.createRequesterTypeLabel')}</Label>
                <Select
                  value={createRequesterType}
                  onValueChange={(v) => setCreateRequesterType(v as WithdrawalRequesterType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RIDER">{t('admin.withdrawals.requesterRider')}</SelectItem>
                    <SelectItem value="MERCHANT">{t('admin.withdrawals.requesterMerchant')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-requester-id">
                  {t('admin.withdrawals.createRequesterIdLabel')}
                </Label>
                <Input
                  id="create-requester-id"
                  value={createRequesterId}
                  onChange={(e) => setCreateRequesterId(e.target.value)}
                  placeholder={t('admin.withdrawals.createRequesterIdPlaceholder')}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-amount">{t('admin.withdrawals.createAmountLabel')}</Label>
              <Input
                id="create-amount"
                type="number"
                min="0"
                step="0.01"
                value={createAmountYuan}
                onChange={(e) => setCreateAmountYuan(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                {t('admin.withdrawals.createAmountHint')}
              </p>
            </div>
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">{t('admin.withdrawals.createPayoutAccountTitle')}</p>
              <div className="space-y-2">
                <Label>{t('admin.withdrawals.createChannelLabel')}</Label>
                <Select
                  value={createChannel}
                  onValueChange={(v) => setCreateChannel(v as PayoutChannel)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BANK_TRANSFER">{t('admin.withdrawals.channelBankTransfer')}</SelectItem>
                    <SelectItem value="WECHAT">{t('admin.withdrawals.channelWechat')}</SelectItem>
                    <SelectItem value="ALIPAY">{t('admin.withdrawals.channelAlipay')}</SelectItem>
                    <SelectItem value="PAYPAL">{t('admin.withdrawals.channelPaypal')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-account">{t('admin.withdrawals.createAccountLabel')}</Label>
                <Input
                  id="create-account"
                  value={createAccount}
                  onChange={(e) => setCreateAccount(e.target.value)}
                  placeholder={t('admin.withdrawals.createAccountPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-holder">{t('admin.withdrawals.createHolderNameLabel')}</Label>
                <Input
                  id="create-holder"
                  value={createHolderName}
                  onChange={(e) => setCreateHolderName(e.target.value)}
                  placeholder={t('admin.withdrawals.createHolderNamePlaceholder')}
                />
              </div>
              {createChannel === 'BANK_TRANSFER' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="create-bank">{t('admin.withdrawals.createBankNameLabel')}</Label>
                    <Input
                      id="create-bank"
                      value={createBankName}
                      onChange={(e) => setCreateBankName(e.target.value)}
                      placeholder={t('admin.withdrawals.createBankNamePlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-branch">{t('admin.withdrawals.createBranchNameLabel')}</Label>
                    <Input
                      id="create-branch"
                      value={createBranchName}
                      onChange={(e) => setCreateBranchName(e.target.value)}
                      placeholder={t('admin.withdrawals.createBranchNamePlaceholder')}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('admin.withdrawals.createDialogCancel')}
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={
                !createRequesterId.trim() ||
                !createAccount.trim() ||
                !createAmountYuan ||
                createMutation.isPending
              }
            >
              {createMutation.isPending ? t('loading') : t('admin.withdrawals.createDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
