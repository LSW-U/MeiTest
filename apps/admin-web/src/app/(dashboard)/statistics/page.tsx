/**
 * 统计报表页 — /statistics
 *
 * W3 占位（M 流程 platform 模块有 dashboard，但深度统计未做）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function StatisticsPage() {
  const t = useTranslations('common');
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.statistics.title')} description={t('admin.statistics.description')} />
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t('admin.statistics.placeholderTitle')}</AlertTitle>
        <AlertDescription>
          {t('admin.statistics.placeholderDescription')}
        </AlertDescription>
      </Alert>
    </div>
  );
}
