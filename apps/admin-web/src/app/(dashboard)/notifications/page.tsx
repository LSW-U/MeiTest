/**
 * 通知管理页 - /notifications
 *
 * admin-web 优化方案 批次3（2026-08-29）
 * 后端：apps/api AdminNotificationController（@Controller('api/v1/admin/notifications')，SUPER_ADMIN）
 *   - POST /admin/notifications   发送（target/type/多语言 title+content）
 *   - GET  /admin/notifications    发送历史（type/page/pageSize，单行近似，无 target）
 *
 * 两个 Tab：
 *   - tabSend：发通知表单（target Select + SPECIFIC_USERS 条件展开 userIds +
 *              type Select + 4 语言 title/content + 发送按钮）
 *   - tabHistory：发送历史 DataTable（type 筛选 Tabs + 分页 + 详情 Dialog）
 *
 * 关键约束（批次2 审查 P2-1）：历史项无 target/isRead，deliveredCount 单行近似（恒 1）。
 * 视角：platform 独占。
 */
'use client';

import { useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api';
import { notifTypeSuffix } from '@/lib/notification';
import {
  useSendNotification,
  useAdminNotificationHistory,
  type AdminNotificationHistoryItem,
  type AdminNotificationType,
  type NotificationTarget,
  type I18nText,
} from '@/hooks/api/use-notifications';

type Row = AdminNotificationHistoryItem;

const PAGE_SIZE = 10;

/** 4 种翻译语言（与 settings 页 SHOP_NAME_LOCALES 对齐） */
const NOTIF_LOCALES = ['en', 'zh', 'id', 'pt'] as const;

/** type 筛选选项（含 ALL） */
const TYPE_FILTERS: { value: AdminNotificationType | 'ALL'; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'admin.notifications.typeAll' },
  { value: 'ORDER_UPDATE', labelKey: 'admin.notifications.typeOrderUpdate' },
  { value: 'PROMOTION', labelKey: 'admin.notifications.typePromotion' },
  { value: 'SYSTEM', labelKey: 'admin.notifications.typeSystem' },
];

export default function NotificationsPage() {
  const t = useTranslations('common');
  const [tab, setTab] = useState<'send' | 'history'>('send');

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.notifications.title')} description={t('admin.notifications.description')} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'send' | 'history')}>
        <TabsList>
          <TabsTrigger value="send">{t('admin.notifications.tabSend')}</TabsTrigger>
          <TabsTrigger value="history">{t('admin.notifications.tabHistory')}</TabsTrigger>
        </TabsList>
        <TabsContent value="send">
          <SendForm onSent={() => setTab('history')} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * 发通知表单。
 *
 * target=SPECIFIC_USERS 时展开 userIds 输入框（契约 refine 强制 userIds 非空）。
 * title/content 均为 4 语言多语言文本（I18nText）。
 */
function SendForm({ onSent }: { onSent: () => void }) {
  const t = useTranslations('common');
  const { toast } = useToast();
  const sendMutation = useSendNotification();

  const [target, setTarget] = useState<NotificationTarget>('ALL_CUSTOMERS');
  const [type, setType] = useState<AdminNotificationType>('SYSTEM');
  const [userIds, setUserIds] = useState('');
  const [title, setTitle] = useState<I18nText>({ en: '', zh: '', id: '', pt: '' });
  const [content, setContent] = useState<I18nText>({ en: '', zh: '', id: '', pt: '' });

  function handleSend() {
    // SPECIFIC_USERS 必填 userIds（契约 refine 校验，后端会再拒，前端先挡）
    if (target === 'SPECIFIC_USERS') {
      const ids = userIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        toast({
          title: t('admin.notifications.userIdsRequired'),
          variant: 'destructive',
        });
        return;
      }
    }

    const body = {
      target,
      ...(target === 'SPECIFIC_USERS'
        ? { userIds: userIds.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
      type,
      title,
      content,
    };

    sendMutation.mutate(body, {
      onSuccess: (res) => {
        toast({ title: t('admin.notifications.sent', { count: res.deliveredCount }) });
        // 发送成功后清空表单并切到历史 Tab
        setTitle({ en: '', zh: '', id: '', pt: '' });
        setContent({ en: '', zh: '', id: '', pt: '' });
        setUserIds('');
        onSent();
      },
      onError: (err) => {
        const message = err instanceof ApiError ? err.message : t('admin.notifications.sendFailed');
        toast({ title: t('admin.notifications.sendFailed'), description: message, variant: 'destructive' });
      },
    });
  }

  return (
    <div className="space-y-4 rounded-md border bg-white p-6 dark:bg-background">
      <div>
        <h2 className="text-base font-semibold">{t('admin.notifications.sendTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('admin.notifications.sendDesc')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 目标 */}
        <div className="space-y-2">
          <Label>{t('admin.notifications.fieldTarget')}</Label>
          <Select value={target} onValueChange={(v) => setTarget(v as NotificationTarget)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_CUSTOMERS">{t('admin.notifications.targetAllCustomers')}</SelectItem>
              <SelectItem value="ALL_RIDERS">{t('admin.notifications.targetAllRiders')}</SelectItem>
              <SelectItem value="SPECIFIC_USERS">{t('admin.notifications.targetSpecific')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 类型 */}
        <div className="space-y-2">
          <Label>{t('admin.notifications.fieldType')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as AdminNotificationType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ORDER_UPDATE">{t('admin.notifications.typeOrderUpdate')}</SelectItem>
              <SelectItem value="PROMOTION">{t('admin.notifications.typePromotion')}</SelectItem>
              <SelectItem value="SYSTEM">{t('admin.notifications.typeSystem')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* SPECIFIC_USERS 展开 userIds 输入 */}
      {target === 'SPECIFIC_USERS' && (
        <div className="space-y-2">
          <Label>{t('admin.notifications.fieldUserIds')}</Label>
          <Input
            value={userIds}
            onChange={(e) => setUserIds(e.target.value)}
            placeholder={t('admin.notifications.placeholderUserIds')}
          />
        </div>
      )}

      {/* 多语言 title */}
      <div className="space-y-2">
        <Label>{t('admin.notifications.fieldTitle')}</Label>
        <div className="grid gap-2 md:grid-cols-2">
          {NOTIF_LOCALES.map((locale) => (
            <Input
              key={`title-${locale}`}
              value={title[locale] ?? ''}
              onChange={(e) => setTitle((prev) => ({ ...prev, [locale]: e.target.value }))}
              placeholder={locale.toUpperCase()}
            />
          ))}
        </div>
      </div>

      {/* 多语言 content */}
      <div className="space-y-2">
        <Label>{t('admin.notifications.fieldContent')}</Label>
        <div className="grid gap-2 md:grid-cols-2">
          {NOTIF_LOCALES.map((locale) => (
            <Textarea
              key={`content-${locale}`}
              value={content[locale] ?? ''}
              onChange={(e) => setContent((prev) => ({ ...prev, [locale]: e.target.value }))}
              rows={3}
              placeholder={locale.toUpperCase()}
            />
          ))}
        </div>
      </div>

      <Button onClick={handleSend} disabled={sendMutation.isPending}>
        {sendMutation.isPending ? t('admin.notifications.sending') : t('admin.notifications.send')}
      </Button>
    </div>
  );
}

/** 发送历史面板：type 筛选 Tabs + 分页 + 详情 Dialog */
function HistoryPanel() {
  const t = useTranslations('common');
  const format = useFormatter();
  const [typeFilter, setTypeFilter] = useState<AdminNotificationType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAdminNotificationHistory({
    type: typeFilter === 'ALL' ? undefined : typeFilter,
    page,
    pageSize: PAGE_SIZE,
  });

  const items: Row[] = data?.items ?? [];
  // 详情直接从当前页数据里取（避免额外请求，单行近似无独立详情端点）
  const detail = items.find((it) => it.id === detailId) ?? null;

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const columns: Column<Row>[] = [
    {
      key: 'type',
      header: t('admin.notifications.columnType'),
      render: (row) => (
        <Badge variant="outline">
          {t(`admin.notifications.type${notifTypeSuffix(row.type)}` as 'admin.notifications.typeSystem')}
        </Badge>
      ),
    },
    {
      key: 'deliveredCount',
      header: t('admin.notifications.columnDelivered'),
      render: (row) => <span className="text-xs font-mono">{row.deliveredCount}</span>,
    },
    {
      key: 'title',
      header: t('admin.notifications.columnTitle'),
      render: (row) => (
        <p className="max-w-md truncate text-xs text-muted-foreground">
          {row.title?.en ?? Object.values(row.title ?? {})[0] ?? '-'}
        </p>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.notifications.columnCreatedAt'),
      render: (row) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setDetailId(row.id)}>
          {t('admin.notifications.viewButton')}
        </Button>
      ),
    },
  ];

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t('admin.notifications.historyTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('admin.notifications.historyDesc')}</p>
      </div>

      {/* type 筛选 Tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v as AdminNotificationType | 'ALL');
            setPage(1);
          }}
        >
          <TabsList>
            {TYPE_FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {t(f.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">{t('loading')}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('admin.notifications.emptyHistory')}
          description={t('admin.notifications.emptyHistoryDesc')}
        />
      ) : (
        <>
          <DataTable
            data={items}
            columns={columns}
            emptyState={
              <EmptyState
                title={t('admin.notifications.emptyHistory')}
                description={t('admin.notifications.emptyHistoryDesc')}
              />
            }
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {t('admin.notifications.pageInfo', {
                page: data?.page ?? 1,
                total: totalPages,
                count: data?.total ?? 0,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('admin.notifications.pagePrev')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!data?.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('admin.notifications.pageNext')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* 详情 Dialog：直接取当前页命中行（历史无独立详情端点） */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('admin.notifications.detailTitle')}</DialogTitle>
            <DialogDescription>{t('admin.notifications.historyDesc')}</DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <DetailField label={t('admin.notifications.columnType')}>
                <Badge variant="outline">
                  {t(`admin.notifications.type${notifTypeSuffix(detail.type)}` as 'admin.notifications.typeSystem')}
                </Badge>
              </DetailField>
              <DetailField label={t('admin.notifications.fieldDelivered')}>
                {detail.deliveredCount}
              </DetailField>
              <DetailField label={t('admin.notifications.fieldTitle')}>
                <MultilineText value={detail.title} />
              </DetailField>
              <DetailField label={t('admin.notifications.fieldContent')}>
                <MultilineText value={detail.content} />
              </DetailField>
              <DetailField label={t('admin.notifications.fieldCreatedAt')}>
                {formatDateTime(detail.createdAt)}
              </DetailField>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 详情字段：label + 值块（统一两列对齐） */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

/** 多语言文本展示：按 locale 逐行（en/zh/id/pt） */
function MultilineText({ value }: { value: I18nText }) {
  const entries = Object.entries(value ?? {}).filter(([, v]) => v);
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  return (
    <div className="space-y-1">
      {entries.map(([locale, v]) => (
        <div key={locale} className="text-sm">
          <span className="mr-1 text-[10px] uppercase text-muted-foreground">{locale}</span>
          <span className="whitespace-pre-wrap">{v}</span>
        </div>
      ))}
    </div>
  );
}
