/**
 * 订单列表页（admin/orders）
 *
 * 状态：W3 占位 — 后端 /admin/orders endpoint 待 W4 补
 * 当前显示 UI 骨架 + "接口待实现"提示
 */
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export default function OrdersListPage() {
  const t = useTranslations();

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t('nav.orders')} description="订单管理系统" />

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>W4 待补</AlertTitle>
        <AlertDescription>
          后端 <code className="rounded bg-muted px-1">/admin/orders</code> endpoint
          未实现（W3-C manifest §6 推到 W4）。UI 骨架已就绪，等后端补完即可启用。
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {['PENDING_PAYMENT', 'PENDING_CONFIRM', 'CONFIRMED', 'OUT_FOR_DELIVERY'].map((s) => (
          <Card key={s}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{s}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">—</div>
              <p className="text-xs text-muted-foreground">接口待实现</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
