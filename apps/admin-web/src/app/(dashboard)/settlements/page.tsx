/**
 * 结算单管理页 — /settlements
 *
 * 后端：
 *   - GET  /admin/settle/settlements              列表（offset 分页）
 *   - POST /admin/settle/settlements/:id/confirm  确认（PENDING → CONFIRMED）
 *   - POST /admin/settle/settlements/run          手动触发（T+1 兜底/调试）
 *
 * 视角：platform（super_admin）
 * 金额字段单位均为「分」，前端用 formatCurrency 转元展示。
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
  useSettlements,
  useConfirmSettlement,
  useRunSettlement,
  type Settlement,
  type SettlementStatus,
  type SettlementSubjectType,
  type RunSettlementInput,
} from '@/hooks/api/use-settlements';
import { formatCurrency } from '@/lib/utils';
import { ApiError } from '@/lib/api';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: SettlementStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.settlements.statusAll' },
  { value: 'PENDING', labelKey: 'admin.settlements.statusPending' },
  { value: 'CONFIRMED', labelKey: 'admin.settlements.statusConfirmed' },
  { value: 'PAID', labelKey: 'admin.settlements.statusPaid' },
  { value: 'DISPUTED', labelKey: 'admin.settlements.statusDisputed' },
];

const SUBJECT_TYPE_LABEL_KEY: Record<SettlementSubjectType, string> = {
  MERCHANT: 'admin.settlements.subjectMerchant',
  RIDER: 'admin.settlements.subjectRider',
};

export default function SettlementsListPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<SettlementStatus | 'ALL'>('ALL');
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<SettlementSubjectType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  // 确认 Dialog
  const [confirmTarget, setConfirmTarget] = useState<Settlement | null>(null);

  // 手动触发 Dialog
  const [runOpen, setRunOpen] = useState(false);
  const [runPeriodDate, setRunPeriodDate] = useState('');
  const [runSubjectType, setRunSubjectType] = useState<SettlementSubjectType>('MERCHANT');
  const [runSubjectId, setRunSubjectId] = useState('');

  // 切筛选条件回到第 1 页（避免停在空页）
  useEffect(() => {
    setPage(1);
  }, [statusFilter, subjectTypeFilter]);

  const { data, isPending, isFetching, error, refetch } = useSettlements({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    subjectType: subjectTypeFilter === 'ALL' ? undefined : subjectTypeFilter,
    page,
    pageSize: PAGE_SIZE,
  });
  const confirmMutation = useConfirmSettlement();
  const runMutation = useRunSettlement();

  const items: Settlement[] = data?.items ?? [];
  const isLoading = isPending || isFetching;
  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  async function handleConfirmSubmit() {
    if (!confirmTarget) return;
    try {
      await confirmMutation.mutateAsync({ id: confirmTarget.id });
      toast({ title: t('admin.settlements.toastConfirmed') });
      setConfirmTarget(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.settlements.toastFailed');
      toast({ title: t('admin.settlements.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  async function handleRunSubmit() {
    const input: RunSettlementInput = {
      subjectType: runSubjectType,
      subjectId: runSubjectId,
      ...(runPeriodDate ? { periodDate: runPeriodDate } : {}),
    };
    try {
      await runMutation.mutateAsync(input);
      toast({ title: t('admin.settlements.toastRun') });
      setRunOpen(false);
      setRunPeriodDate('');
      setRunSubjectId('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.settlements.toastFailed');
      toast({ title: t('admin.settlements.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  const columns: Column<Settlement>[] = [
    {
      key: 'periodDate',
      header: t('admin.settlements.columnPeriod'),
      render: (row) => <span className="font-mono text-sm">{row.periodDate}</span>,
    },
    {
      key: 'subject',
      header: t('admin.settlements.columnSubject'),
      render: (row) => (
        <div className="space-y-0.5">
          <span className="text-sm font-medium">{t(SUBJECT_TYPE_LABEL_KEY[row.subjectType])}</span>
          <p className="text-xs text-muted-foreground font-mono">{row.subjectId}</p>
        </div>
      ),
    },
    {
      key: 'orderCount',
      header: t('admin.settlements.columnOrderCount'),
      render: (row) => <span className="text-sm">{row.orderCount}</span>,
    },
    {
      key: 'grossAmount',
      header: t('admin.settlements.columnGross'),
      render: (row) => (
        <span className="font-mono text-sm">{formatCurrency(row.grossAmount)}</span>
      ),
    },
    {
      key: 'commission',
      header: t('admin.settlements.columnCommission'),
      render: (row) => (
        <span className="font-mono text-sm text-muted-foreground">
          -{formatCurrency(row.commission)}
        </span>
      ),
    },
    {
      key: 'refundAmount',
      header: t('admin.settlements.columnRefund'),
      render: (row) => (
        <span className="font-mono text-sm text-muted-foreground">
          -{formatCurrency(row.refundAmount)}
        </span>
      ),
    },
    {
      key: 'netAmount',
      header: t('admin.settlements.columnNet'),
      render: (row) => (
        <span className="font-mono text-sm font-bold text-primary">{formatCurrency(row.netAmount)}</span>
      ),
    },
    {
      key: 'status',
      header: t('admin.settlements.columnStatus'),
      render: (row) => <StatusBadge status={row.status} label={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'PENDING' ? (
          <Button
            size="sm"
            onClick={() => setConfirmTarget(row)}
            disabled={confirmMutation.isPending}
          >
            {t('admin.settlements.confirmButton')}
          </Button>
        ) : row.confirmedAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(row.confirmedAt).toLocaleDateString()}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.settlements.title')}
        description={t('admin.settlements.description')}
        action={
          <Button onClick={() => setRunOpen(true)}>{t('admin.settlements.runButton')}</Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as SettlementStatus | 'ALL')}
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
          value={subjectTypeFilter}
          onValueChange={(v) => setSubjectTypeFilter(v as SettlementSubjectType | 'ALL')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t('admin.settlements.subjectAll')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('admin.settlements.subjectAll')}</SelectItem>
            <SelectItem value="MERCHANT">{t('admin.settlements.subjectMerchant')}</SelectItem>
            <SelectItem value="RIDER">{t('admin.settlements.subjectRider')}</SelectItem>
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
          title={t('admin.settlements.empty')}
          description={t('admin.settlements.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 分页器 */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t('admin.settlements.pageInfo', {
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
              {t('admin.settlements.prevPage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
            >
              {t('admin.settlements.nextPage')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 确认结算 Dialog */}
      <Dialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.settlements.confirmDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.settlements.confirmDialogDescription', {
                period: confirmTarget?.periodDate ?? '',
                subject:
                  confirmTarget ? t(SUBJECT_TYPE_LABEL_KEY[confirmTarget.subjectType]) : '',
                net: confirmTarget ? formatCurrency(confirmTarget.netAmount) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              {t('admin.settlements.confirmDialogCancel')}
            </Button>
            <Button onClick={handleConfirmSubmit} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending
                ? t('loading')
                : t('admin.settlements.confirmDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动触发结算 Dialog */}
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.settlements.runDialogTitle')}</DialogTitle>
            <DialogDescription>{t('admin.settlements.runDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="run-period">{t('admin.settlements.runDialogPeriodLabel')}</Label>
              <Input
                id="run-period"
                type="date"
                value={runPeriodDate}
                onChange={(e) => setRunPeriodDate(e.target.value)}
                placeholder={t('admin.settlements.runDialogPeriodPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('admin.settlements.runDialogPeriodHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t('admin.settlements.runDialogSubjectTypeLabel')}</Label>
              <Select
                value={runSubjectType}
                onValueChange={(v) => setRunSubjectType(v as SettlementSubjectType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MERCHANT">{t('admin.settlements.subjectMerchant')}</SelectItem>
                  <SelectItem value="RIDER">{t('admin.settlements.subjectRider')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="run-subject-id">{t('admin.settlements.runDialogSubjectIdLabel')}</Label>
              <Input
                id="run-subject-id"
                value={runSubjectId}
                onChange={(e) => setRunSubjectId(e.target.value)}
                placeholder={t('admin.settlements.runDialogSubjectIdPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>
              {t('admin.settlements.runDialogCancel')}
            </Button>
            <Button
              onClick={handleRunSubmit}
              disabled={!runSubjectId.trim() || runMutation.isPending}
            >
              {runMutation.isPending ? t('loading') : t('admin.settlements.runDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
