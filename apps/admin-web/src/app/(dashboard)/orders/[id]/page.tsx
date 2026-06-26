/**
 * 订单详情页（admin/orders/[id]）
 *
 * 状态：W3 占位 — 后端 /admin/orders/:id 待 W4 补
 */
'use client';

import { use } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={`${t('nav.orders')} #${id.slice(0, 8)}`} description="订单详情" />

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>W4 待补</AlertTitle>
        <AlertDescription>
          后端 <code className="rounded bg-muted px-1">/admin/orders/:id</code> endpoint
          未实现，详情数据无法加载。W4 后端补完后此页面自动启用。
        </AlertDescription>
      </Alert>
    </div>
  );
}
