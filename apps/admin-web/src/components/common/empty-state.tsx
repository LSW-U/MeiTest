/**
 * EmptyState — 空数据状态
 */
'use client';

import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  const t = useTranslations('common');
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="text-muted-foreground">
        {icon ?? <Inbox className="mx-auto h-8 w-8" />}
      </div>
      <div>
        <p className="text-sm font-medium">{title ?? t('noData')}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
