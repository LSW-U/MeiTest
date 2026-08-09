/**
 * 审计日志页 — /audit-logs
 *
 * 后端：
 *   - GET /admin/platform/audit-logs          列表（游标分页 cursor + 加载更多）
 *   - GET /admin/platform/audit-logs/:id      详情（含 beforeData/afterData）
 *   - GET /admin/platform/audit-logs/export   导出 CSV
 *
 * 视角：platform（super_admin）
 * 游标分页：useInfiniteQuery + fetchNextPage + data.pages.flatMap 累积 items（非 offset 分页器）
 * 详情：beforeData/afterData JSON 展示（契约未约束结构，按 raw JSON stringify）
 */
'use client';

import { useState, useDeferredValue } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Download, Loader2 } from 'lucide-react';
import {
  useAuditLogs,
  useAuditLogDetail,
  exportAuditCsv,
  type AuditLog,
  type AuditDeviceType,
} from '@/hooks/api/use-audit-logs';
import { ApiError } from '@/lib/api';

const PAGE_LIMIT = 50;

const DEVICE_TYPE_LABEL_KEY: Record<AuditDeviceType, string> = {
  CLIENT_APP: 'admin.auditLogs.deviceTypeClientApp',
  RIDER_APP: 'admin.auditLogs.deviceTypeRiderApp',
  ADMIN_WEB: 'admin.auditLogs.deviceTypeAdminWeb',
};

function formatJson(v: unknown): string {
  if (v === null || v === undefined) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function AuditLogsListPage() {
  const t = useTranslations('common');
  const { toast } = useToast();

  // 筛选 state（action/userId/resourceType 输入用 useDeferredValue 防抖）
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  const deferredResourceType = useDeferredValue(resourceTypeFilter);
  const deferredAction = useDeferredValue(actionFilter);
  const deferredUserId = useDeferredValue(userIdFilter);

  // 详情 Dialog
  const [detailTarget, setDetailTarget] = useState<AuditLog | null>(null);

  const params = {
    resourceType: deferredResourceType.trim() || undefined,
    action: deferredAction.trim() || undefined,
    userId: deferredUserId.trim() || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
    limit: PAGE_LIMIT,
  };

  const {
    data,
    isPending,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAuditLogs(params);

  const items: AuditLog[] = data?.pages.flatMap((p) => p.items) ?? [];
  const isLoading = isPending;

  // 导出 CSV
  async function handleExport() {
    try {
      await exportAuditCsv(params);
      toast({ title: t('admin.auditLogs.toastExported') });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('admin.auditLogs.toastFailed');
      toast({ title: t('admin.auditLogs.toastFailed'), description: message, variant: 'destructive' });
    }
  }

  const columns: Column<AuditLog>[] = [
    {
      key: 'createdAt',
      header: t('admin.auditLogs.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground font-mono">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'action',
      header: t('admin.auditLogs.columnAction'),
      render: (row) => <span className="font-mono text-sm font-medium">{row.action}</span>,
    },
    {
      key: 'resourceType',
      header: t('admin.auditLogs.columnResourceType'),
      render: (row) => (
        <div className="space-y-0.5">
          <span className="text-sm">{row.resourceType}</span>
          {row.resourceId && (
            <p className="text-xs text-muted-foreground font-mono">{row.resourceId.slice(0, 8)}...</p>
          )}
        </div>
      ),
    },
    {
      key: 'userId',
      header: t('admin.auditLogs.columnUserId'),
      render: (row) =>
        row.userId ? (
          <span className="text-xs text-muted-foreground font-mono">{row.userId.slice(0, 8)}...</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'perspective',
      header: t('admin.auditLogs.columnPerspective'),
      render: (row) =>
        row.perspective ? (
          <span className="text-xs">{row.perspective}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'deviceType',
      header: t('admin.auditLogs.columnDeviceType'),
      render: (row) =>
        row.deviceType ? (
          <span className="text-xs">{t(DEVICE_TYPE_LABEL_KEY[row.deviceType])}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setDetailTarget(row)}>
          {t('admin.auditLogs.detailButton')}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('admin.auditLogs.title')}
        description={t('admin.auditLogs.description')}
        action={
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4" />
            {t('admin.auditLogs.exportButton')}
          </Button>
        }
      />

      {/* 多维筛选 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.auditLogs.filterResourceType')}</Label>
          <Input
            value={resourceTypeFilter}
            onChange={(e) => setResourceTypeFilter(e.target.value)}
            placeholder={t('admin.auditLogs.filterResourceTypePlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.auditLogs.filterAction')}</Label>
          <Input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder={t('admin.auditLogs.filterActionPlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.auditLogs.filterUserId')}</Label>
          <Input
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder={t('admin.auditLogs.filterUserIdPlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.auditLogs.filterFrom')}</Label>
          <Input
            type="date"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.auditLogs.filterTo')}</Label>
          <Input type="date" value={toFilter} onChange={(e) => setToFilter(e.target.value)} />
        </div>
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.auditLogs.empty')}
          description={t('admin.auditLogs.emptyDescription')}
        />
      ) : (
        <DataTable data={items} columns={columns} />
      )}

      {/* 游标「加载更多」 */}
      {items.length > 0 && (
        <div className="flex items-center justify-center">
          {hasNextPage ? (
            <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('admin.auditLogs.loadingMore')}
                </>
              ) : (
                t('admin.auditLogs.loadMoreButton')
              )}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('admin.auditLogs.noMore', { count: items.length })}
            </span>
          )}
        </div>
      )}

      {/* 详情 Dialog */}
      <AuditLogDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />
    </div>
  );
}

/** 详情 Dialog：拉取 detail（含 beforeData/afterData），JSON 展示 */
function AuditLogDetailDialog({ target, onClose }: { target: AuditLog | null; onClose: () => void }) {
  const t = useTranslations('common');
  const { data, isPending } = useAuditLogDetail(target?.id);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('admin.auditLogs.detailDialogTitle')}</DialogTitle>
          <DialogDescription>
            {target
              ? `${target.action} · ${target.resourceType}${target.resourceId ? ' / ' + target.resourceId.slice(0, 8) : ''}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="p-4 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : data ? (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">{t('admin.auditLogs.columnUserId')}:</span>{' '}
                <span className="font-mono">{data.userId ?? '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('admin.auditLogs.columnDeviceType')}:
                </span>{' '}
                {data.deviceType ? t(DEVICE_TYPE_LABEL_KEY[data.deviceType]) : '—'}
              </div>
              <div>
                <span className="text-muted-foreground">{t('admin.auditLogs.columnPerspective')}:</span>{' '}
                {data.perspective ?? '—'}
              </div>
              <div>
                <span className="text-muted-foreground">IP:</span> <span className="font-mono">{data.ip ?? '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('admin.auditLogs.detailTraceId')}:</span>{' '}
                <span className="font-mono">{data.traceId ?? '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('admin.auditLogs.detailUserAgent')}:</span>{' '}
                <span className="font-mono break-all">{data.userAgent ?? '—'}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">{t('admin.auditLogs.detailBeforeData')}</Label>
              <pre className="rounded bg-muted p-3 text-xs font-mono overflow-x-auto">
                {formatJson(data.beforeData) || t('admin.auditLogs.detailNoData')}
              </pre>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">{t('admin.auditLogs.detailAfterData')}</Label>
              <pre className="rounded bg-muted p-3 text-xs font-mono overflow-x-auto">
                {formatJson(data.afterData) || t('admin.auditLogs.detailNoData')}
              </pre>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
