/**
 * 系统设置页 — /settings
 *
 * W3 占位（M 流程 platform/system-config 已实现，admin UI 待补）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function SettingsPage() {
  const t = useTranslations();
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('nav.settings')} description="系统配置（W4 admin UI 待补）" />
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>占位页</AlertTitle>
        <AlertDescription>
          M 流程 <code className="rounded bg-muted px-1">platform/system-config</code> 后端
          已实现（CRUD + Redis cache-aside），admin UI 待 W4 补。
        </AlertDescription>
      </Alert>
    </div>
  );
}
