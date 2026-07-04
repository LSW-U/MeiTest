/**
 * 客户管理页 — /customers
 *
 * W3 占位（后端 /admin/customers 待补，目前 W2-W 有 user 模块但仅 client 视角）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function CustomersPage() {
  const t = useTranslations('common');
  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('admin.customers.title')} description={t('admin.customers.description')} />
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>{t('admin.customers.placeholderTitle')}</AlertTitle>
        <AlertDescription>
          {t('admin.customers.placeholderDescription')}
        </AlertDescription>
      </Alert>
    </div>
  );
}
