/**
 * 仓库负载面板（批 E，2026-09-03）— 方案 Q12
 *
 * 批 C2（2026-09-04）上移至 components/warehouse/ 共享：dispatch 页 + 仓库列表/详情负载内嵌共用。
 * 行为不变，仅同步更新 dispatch/page.tsx 的 import。
 *
 * 后端：GET /admin/dispatch/warehouse-load（30s 轮询，hooks 内）
 * 预警：可用骑手 = 0 或 待派/骑手比 > 3 → 红色高亮 +「跨仓支援」快捷按钮
 *   （跨仓入口选中该仓第一个待派任务，展开派单中心候选并提示开跨仓）
 */
'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useWarehouseLoad, type WarehouseLoadItem } from '@/hooks/api/use-deposit';

/** 预警阈值：待派/可用骑手比（任务书 §七：如 3） */
export const LOAD_RATIO_ALERT = 3;

/** 预警规则（保证金批 C 定稿）：可用骑手=0（且有待派）或 待派/骑手比 > 阈值 → 红高亮 */
export function isAlert(load: WarehouseLoadItem): boolean {
  if (load.availableRiderCount === 0) return load.pendingTaskCount > 0;
  return load.pendingTaskCount / load.availableRiderCount > LOAD_RATIO_ALERT;
}

/** 单仓三指标（待派单 / 可用骑手 / 预计等待）——全局面板 / 详情负载卡 / 列表列共用渲染口径（批 C2 修复 P2-2） */
export function LoadMetrics({ load, alert }: { load: WarehouseLoadItem; alert: boolean }) {
  const t = useTranslations('common');
  const valueCls = `text-lg font-bold ${alert ? 'text-destructive' : ''}`;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div>
        <div className={valueCls}>{load.pendingTaskCount}</div>
        <div className="text-xs text-muted-foreground">{t('admin.warehouseLoad.pending')}</div>
      </div>
      <div>
        <div className={valueCls}>{load.availableRiderCount}</div>
        <div className="text-xs text-muted-foreground">{t('admin.warehouseLoad.available')}</div>
      </div>
      <div>
        <div className="text-lg font-bold">{load.estWaitMinutes}</div>
        <div className="text-xs text-muted-foreground">{t('admin.warehouseLoad.estWait')}</div>
      </div>
    </div>
  );
}

/** 批E审查 P2-2 接线（2026-09-03）：跨仓按钮带 warehouseId，父组件定位到派单中心该仓 */
export function WarehouseLoadPanel({ onCrossSupport }: { onCrossSupport?: (warehouseId: string) => void }) {
  const t = useTranslations('common');
  const { data: loads, isPending, isError } = useWarehouseLoad();

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !loads) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('error.loadFailed')}</p>;
  }
  if (loads.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t('admin.warehouseLoad.empty')}</p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {loads.map((load) => {
        const alert = isAlert(load);
        return (
          <Card key={load.warehouseId} className={alert ? 'border-destructive' : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {load.warehouseCode}
                  </Badge>
                  {load.warehouseName ?? ''}
                </span>
                {alert && <AlertTriangle className="h-4 w-4 text-destructive" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <LoadMetrics load={load} alert={alert} />
              {alert && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => onCrossSupport?.(load.warehouseId)}>
                  {t('admin.warehouseLoad.crossSupport')}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
