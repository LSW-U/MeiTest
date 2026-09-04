/**
 * WarehouseLoadCard — 详情页·负载卡（批 C2，Codex设计 §3.8 / §7）
 *
 * 复用批 E WarehouseLoadPanel 的数据源（useWarehouseLoad，30s 轮询）、预警规则（isAlert）
 * 与三指标渲染（LoadMetrics），按 warehouseId 过滤为单仓视图：
 * - loading / error（可重试）/ 空态（暂无负载数据）/ 数据 三态 + 预警红高亮
 * - 预警时「跨仓支援」→ 跳转 /dispatch?warehouseId=xxx#dispatch-center
 *   （dispatch 页 P2-1 修复后已消费该参数初始化仓筛选）
 */
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/common/error-state';
import { isAlert, LoadMetrics } from '@/components/warehouse/warehouse-load-panel';
import { useWarehouseLoad } from '@/hooks/api/use-deposit';

/** 跨仓入口统一跳转：query 带 warehouseId 上下文（dispatch 页 P2-1 已消费）+ hash 定位派单中心 */
export function goDispatchCenter(router: { push: (href: string) => void }, warehouseId: string) {
  router.push(`/dispatch?warehouseId=${warehouseId}#dispatch-center`);
}

export function WarehouseLoadCard({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations('common');
  const router = useRouter();
  const { data: loads, isPending, isError, error, refetch } = useWarehouseLoad();

  const load = loads?.find((l) => l.warehouseId === warehouseId) ?? null;
  const alert = load ? isAlert(load) : false;

  return (
    <Card className={`h-full ${alert ? 'border-destructive' : undefined}`}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('w.warehouses.cardLoadTitle')}</CardTitle>
        {alert && <AlertTriangle className="h-4 w-4 text-destructive" />}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : isError ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : !load ? (
          // 该仓不在负载列表（无派单数据/未上报）：与接口错误区分
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('w.warehouses.loadNoData')}
          </p>
        ) : (
          <div className="space-y-3">
            <LoadMetrics load={load} alert={alert} />
            {alert && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => goDispatchCenter(router, warehouseId)}
              >
                {t('admin.warehouseLoad.crossSupport')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
