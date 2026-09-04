/**
 * WarehouseLoadPlaceholderCard — 详情页·负载占位卡（Codex设计 §3.8 / §7）
 *
 * C1 不请求数据（不发 /admin/dispatch/warehouse-load）；C2 用 WarehouseLoadPanel 替换。
 * 预留展示字段：待派单数 / 可用骑手数 / 预计等待（C2 接入）。
 */
'use client';

import { useTranslations } from 'next-intl';
import { Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface WarehouseLoadPlaceholderCardProps {
  warehouseId: string;
}

export function WarehouseLoadPlaceholderCard({ warehouseId }: WarehouseLoadPlaceholderCardProps) {
  void warehouseId; // C2 接入时用于拉取负载
  const t = useTranslations('common');

  return (
    <Card className="h-full border-dashed bg-muted/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-muted-foreground">
          <Gauge className="h-4 w-4" />
          {t('w.warehouses.cardLoadTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t('w.warehouses.loadPlaceholderHint')}</p>
        {/* 预留字段（C2）：待派单数 / 可用骑手数 / 预计等待 */}
      </CardContent>
    </Card>
  );
}
