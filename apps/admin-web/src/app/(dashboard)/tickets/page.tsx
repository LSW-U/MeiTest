/**
 * 工单管理页 — /tickets（替换品批3 D22，2026-10-30）
 *
 * 后端：GET /admin/tickets + GET /admin/tickets/:ticketNo + POST /admin/tickets/:ticketNo/status
 * 守卫：SUPER_ADMIN + CUSTOMER_SERVICE（D22 独立客服角色，非类级独占）
 * 视角：platform + support（sidebar 同步）；admin-web 不做 role 隐藏，后端 RBAC 兜底
 *
 * 功能：
 *   1. 列表（DataTable + 游标加载更多）+ 状态 Tabs 筛选 + escalated 筛选/行高亮（D18）
 *   2. 详情 Dialog：字段 + 时间线（TicketEvent）
 *   3. 状态流转 Dialog：D18 四态线性（OPEN→IN_PROGRESS→RESOLVED→CLOSED），
 *      仅合法下一态可点（TICKET_ALLOWED_TRANSITIONS 预判，权威在后端 409 兜底）
 *
 * P2-2：工单查询不依赖封号状态——后端 JWT guard 不查 user.status，前端零额外处理。
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Eye, TriangleAlert } from 'lucide-react';
import {
  useAdminTickets,
  useAdminTicketDetail,
  useUpdateTicketStatus,
  type AdminTicket,
  type TicketStatus,
} from '@/hooks/api/use-tickets';

const STATUS_FILTERS: { value: TicketStatus | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.tickets.filterAll' },
  { value: 'OPEN', labelKey: 'admin.tickets.status_OPEN' },
  { value: 'IN_PROGRESS', labelKey: 'admin.tickets.status_IN_PROGRESS' },
  { value: 'RESOLVED', labelKey: 'admin.tickets.status_RESOLVED' },
  { value: 'CLOSED', labelKey: 'admin.tickets.status_CLOSED' },
];

const TYPE_LABEL_KEY: Record<string, string> = {
  CUSTOMER_UNREACHABLE: 'admin.tickets.type_CUSTOMER_UNREACHABLE',
  CUSTOMER_REJECTED: 'admin.tickets.type_CUSTOMER_REJECTED',
  ADDRESS_NOT_FOUND: 'admin.tickets.type_ADDRESS_NOT_FOUND',
  TRAFFIC_ACCIDENT: 'admin.tickets.type_TRAFFIC_ACCIDENT',
  OTHER: 'admin.tickets.type_OTHER',
  FEEDBACK: 'admin.tickets.type_FEEDBACK',
};

/** 线性流转的下一态（D18：每态最多一个合法后继） */
const NEXT_STATUS: Partial<Record<TicketStatus, TicketStatus>> = {
  OPEN: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
  RESOLVED: 'CLOSED',
};

export default function TicketsPage() {
  const t = useTranslations('common');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [detailTarget, setDetailTarget] = useState<AdminTicket | null>(null);
  // 流转目标：detail Dialog 内发起，关闭详情打开流转
  const [transitionTarget, setTransitionTarget] = useState<AdminTicket | null>(null);
  const [transitionNote, setTransitionNote] = useState('');

  const {
    data,
    isPending,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAdminTickets({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    escalated: escalatedOnly || undefined,
    limit: 50,
  });
  const transitionMutation = useUpdateTicketStatus();

  const items: AdminTicket[] = data?.pages.flatMap((p) => p.items) ?? [];

  function handleTransitionSubmit() {
    if (!transitionTarget) return;
    const next = NEXT_STATUS[transitionTarget.status];
    if (!next) return;
    transitionMutation.mutate(
      {
        ticketNo: transitionTarget.ticketNo,
        input: { action: next, note: transitionNote.trim() || undefined },
      },
      {
        onSuccess: () => {
          setTransitionTarget(null);
          setTransitionNote('');
          setDetailTarget(null);
        },
      },
    );
  }

  const columns: Column<AdminTicket>[] = [
    {
      key: 'ticketNo',
      header: t('admin.tickets.columnTicketNo'),
      render: (row) => (
        <span className="font-mono text-xs">{row.ticketNo}</span>
      ),
    },
    {
      key: 'type',
      header: t('admin.tickets.columnType'),
      render: (row) => (
        <span className="text-sm">
          {TYPE_LABEL_KEY[row.type] ? t(TYPE_LABEL_KEY[row.type]) : row.type}
        </span>
      ),
    },
    {
      key: 'escalated',
      header: t('admin.tickets.columnEscalated'),
      render: (row) =>
        row.escalated ? (
          <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            <TriangleAlert className="h-3 w-3" aria-hidden />
            {t('admin.tickets.escalatedBadge')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'createdAt',
      header: t('admin.tickets.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.tickets.columnStatus'),
      render: (row) => (
        <StatusBadge
          status={row.status}
          label={
            STATUS_FILTERS.find((s) => s.value === row.status)?.labelKey
              ? t(STATUS_FILTERS.find((s) => s.value === row.status)!.labelKey)
              : row.status
          }
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          {NEXT_STATUS[row.status] && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTransitionTarget(row);
                setTransitionNote('');
              }}
              disabled={transitionMutation.isPending}
            >
              {t('admin.tickets.statusAction', {
                status: t(
                  STATUS_FILTERS.find((s) => s.value === NEXT_STATUS[row.status])!.labelKey,
                ),
              })}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => setDetailTarget(row)}>
            <Eye className="h-3 w-3" /> {t('admin.refunds.viewDetail')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.tickets.title')}
        description={t('admin.tickets.description')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as TicketStatus | 'ALL')}
        >
          <TabsList>
            {STATUS_FILTERS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {t(s.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          size="sm"
          variant={escalatedOnly ? 'default' : 'outline'}
          className="gap-1"
          onClick={() => setEscalatedOnly((v) => !v)}
        >
          <TriangleAlert className="h-3 w-3" aria-hidden />
          {t('admin.tickets.escalatedOnly')}
        </Button>
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t('loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('admin.tickets.empty')} />
      ) : (
        <>
          <DataTable data={items} columns={columns} />
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
                    {t('admin.refunds.loadingMore')}
                  </>
                ) : (
                  t('admin.tickets.loadMore')
                )}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('admin.refunds.noMore', { count: items.length })}
              </span>
            )}
          </div>
        </>
      )}

      {/* 详情 Dialog（含时间线） */}
      <TicketDetailDialog
        ticketNo={detailTarget?.ticketNo ?? null}
        onClose={() => setDetailTarget(null)}
        onTransition={(ticket) => {
          setDetailTarget(null);
          setTransitionTarget(ticket);
          setTransitionNote('');
        }}
      />

      {/* 状态流转 Dialog */}
      <Dialog
        open={!!transitionTarget}
        onOpenChange={(open) => !open && setTransitionTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.tickets.statusDialogTitle')}</DialogTitle>
          </DialogHeader>
          {transitionTarget && (
            <div className="space-y-3">
              <p className="font-mono text-xs text-muted-foreground">
                {transitionTarget.ticketNo}
              </p>
              <p className="text-sm">
                {t('admin.tickets.statusAction', {
                  status: t(
                    STATUS_FILTERS.find(
                      (s) => s.value === NEXT_STATUS[transitionTarget.status],
                    )!.labelKey,
                  ),
                })}
              </p>
              <div className="space-y-2">
                <Label htmlFor="ticket-transition-note">
                  {t('admin.tickets.statusNotePlaceholder')}
                </Label>
                <Textarea
                  id="ticket-transition-note"
                  value={transitionNote}
                  onChange={(e) => setTransitionNote(e.target.value)}
                  placeholder={t('admin.tickets.statusNotePlaceholder')}
                  rows={3}
                  maxLength={500}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransitionTarget(null)}>
              {t('admin.refunds.commonCancel')}
            </Button>
            <Button onClick={handleTransitionSubmit} disabled={transitionMutation.isPending}>
              {transitionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('admin.tickets.statusDialogConfirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 详情 Dialog：字段 + 时间线（useAdminTicketDetail dependent query） */
function TicketDetailDialog(opts: {
  ticketNo: string | null;
  onClose: () => void;
  onTransition: (ticket: AdminTicket) => void;
}) {
  const t = useTranslations('common');
  const detailQuery = useAdminTicketDetail(opts.ticketNo ?? undefined);
  const detail = detailQuery.data ?? null;
  const next = detail ? NEXT_STATUS[detail.status] : undefined;

  return (
    <Dialog open={!!opts.ticketNo} onOpenChange={(open) => !open && opts.onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('admin.tickets.detailTitle', { ticketNo: opts.ticketNo ?? '' })}
          </DialogTitle>
        </DialogHeader>
        {detailQuery.isPending && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
        {detailQuery.error && (
          <ErrorState message={detailQuery.error.message} onRetry={() => detailQuery.refetch()} />
        )}
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.tickets.columnStatus')}</p>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={detail.status}
                    label={t(`admin.tickets.status_${detail.status}`)}
                  />
                  {detail.escalated && (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                      <TriangleAlert className="h-3 w-3" aria-hidden />
                      {t('admin.tickets.escalatedBadge')}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.tickets.columnType')}</p>
                <p>
                  {TYPE_LABEL_KEY[detail.type] ? t(TYPE_LABEL_KEY[detail.type]) : detail.type}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.tickets.detailUser')}</p>
                <p className="font-mono text-xs">{detail.userId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('admin.tickets.detailSource')}</p>
                <p className="font-mono text-xs">
                  {detail.sourceType} · {detail.sourceId}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t('admin.tickets.columnFirstRespDue')}
                </p>
                <p className="text-xs">
                  {detail.firstRespDue
                    ? new Date(detail.firstRespDue).toLocaleString()
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t('admin.tickets.columnResolveDue')}
                </p>
                <p className="text-xs">
                  {detail.resolveDue ? new Date(detail.resolveDue).toLocaleString() : '—'}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t('admin.tickets.detailTime')}
              </p>
              {detail.events.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('admin.tickets.detailNoEvents')}</p>
              ) : (
                <ul className="space-y-1">
                  {detail.events.map((e) => (
                    <li key={e.id} className="text-xs">
                      <span className="font-mono">{e.eventType}</span>
                      <span className="ml-1 rounded bg-muted px-1 text-[10px]">
                        {e.operatorType}
                      </span>
                      {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                      <span className="text-muted-foreground">
                        {' '}
                        · {new Date(e.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={opts.onClose}>
            {t('admin.refunds.commonCancel')}
          </Button>
          {detail && next && (
            <Button
              onClick={() => opts.onTransition(detail)}
              disabled={transitionPendingSafe()}
            >
              {t('admin.tickets.statusAction', { status: t(`admin.tickets.status_${next}`) })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /** 详情 Dialog 内不再独立持 mutation（流转统一走外层 Dialog 提交） */
  function transitionPendingSafe() {
    return false;
  }
}
