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
  const t = useTranslations();
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('nav.statistics')} description="深度统计报表（W6 待实现）" />
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>占位页</AlertTitle>
        <AlertDescription>
          M 流程 <code className="rounded bg-muted px-1">platform</code> 模块已提供 dashboard
          summary，深度报表（趋势/漏斗/转化）待 W6 实现。
        </AlertDescription>
      </Alert>
    </div>
  );
}
