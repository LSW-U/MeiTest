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
  const t = useTranslations('common');
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.settings.title')} description={t('admin.settings.description')} />
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t('admin.settings.placeholderTitle')}</AlertTitle>
        <AlertDescription>
          {t('admin.settings.placeholderDescription')}
        </AlertDescription>
      </Alert>
    </div>
  );
}
