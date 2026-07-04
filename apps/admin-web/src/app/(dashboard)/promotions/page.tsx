/**
 * 营销管理页 — /promotions
 *
 * W3 占位（CLAUDE.md MVP 范围未列促销模块，预留路由）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function PromotionsPage() {
  const t = useTranslations('common');
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.promotions.title')} description={t('admin.promotions.description')} />
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t('admin.promotions.placeholderTitle')}</AlertTitle>
        <AlertDescription>
          {t('admin.promotions.placeholderDescription')}
        </AlertDescription>
      </Alert>
    </div>
  );
}
