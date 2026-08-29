/**
 * NotificationBell — Header 通知铃铛下拉
 *
 * admin-web 优化方案 批次3（2026-08-29）
 *
 * 复用 GET /admin/notifications（admin 发送历史，pageSize=5）。
 * 不调 /client/notifications：super_admin via admin_web 被 DeviceTypeGuard 拦截（E-AUTH-001）。
 *
 * 关键约束（批次2 审查 P2-1）：历史项无 isRead/target 字段，deliveredCount 单行近似。
 * 故铃铛语义为「最近发送历史 + 计数」，不做未读/已读/全部已读。
 */
'use client';

import { Bell } from 'lucide-react';
import { useTranslations, useFormatter } from 'next-intl';
import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { useAdminRecentNotifications } from '@/hooks/api/use-notifications';

export function NotificationBell() {
  const t = useTranslations('common');
  const format = useFormatter();
  const { data, isLoading, error, refetch } = useAdminRecentNotifications(5);

  const items = data?.items ?? [];
  const count = data?.total ?? 0;

  function formatDateTime(date: string): string {
    return format.dateTime(new Date(date), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('admin.notifications.bellTitle')}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t('admin.notifications.bellTitle')}</span>
          <Link
            href="/notifications"
            className="text-xs text-primary hover:underline"
          >
            {t('admin.notifications.bellViewAll')}
          </Link>
        </div>

        {error ? (
          <div className="p-3">
            <ErrorState onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t('admin.notifications.bellEmpty')}
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {items.map((it) => (
              <li key={it.id} className="space-y-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {t(`admin.notifications.type${typeSuffix(it.type)}` as 'admin.notifications.typeSystem')}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(it.createdAt)}
                  </span>
                </div>
                <p className="truncate text-xs font-medium">
                  {it.title?.en ?? Object.values(it.title ?? {})[0] ?? '-'}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {it.content?.en ?? Object.values(it.content ?? {})[0] ?? ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 通知类型 → i18n key 后缀（ORDER_UPDATE → OrderUpdate，对齐 typeOrderUpdate） */
function typeSuffix(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
