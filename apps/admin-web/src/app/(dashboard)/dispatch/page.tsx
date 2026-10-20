/**
 * 配送调度管理页 — /dispatch（任务监控独立页批1 20261019 瘦身版）
 *
 * 后端：apps/api/src/modules/dispatch/admin-dispatch.controller.ts
 *   - GET    /admin/dispatch/riders/available         可派骑手
 *   - POST   /admin/dispatch/orders/:orderId/recreate 补建（已随迁 /dispatch/tasks）
 *
 * 视角：platform（super_admin 写；customer_service 只读，admin-web 不做 role 隐藏，后端 RBAC 兜底）
 *
 * 变更（方案v2-任务监控独立页-20261019）：
 *   - 任务监控区 + 详情/改派/取消三 Dialog + 补建按钮/Dialog 抽迁新页 /dispatch/tasks
 *   - 本页保留：仓库负载面板 + 派单中心 + 派单权重卡（纯派单运营）
 *   - 派单中心下方「查看任务监控 →」兜底链接（老用户过渡）
 *   - ?warehouseId= 旧链接：跨仓支援主链路走 WarehouseLoadPanel onCrossSupport +
 *     #dispatch-center 锚点滚动（仓库卡片 router.push），监控仓筛选已随迁新页，query 不再消费
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { WarehouseLoadPanel } from '@/components/warehouse/warehouse-load-panel';
import { DispatchCenter } from './dispatch-center';
import { DispatchWeightsCard } from './dispatch-weights-card';
import { ChevronRight } from 'lucide-react';

export default function DispatchTasksPage() {
  const t = useTranslations('common');
  // P2-2 接线（2026-09-03）：仓负载预警卡跨仓入口 → 派单中心该仓（nonce 触发 effect）
  const [crossSupportTarget, setCrossSupportTarget] = useState<{ warehouseId: string; nonce: number } | null>(null);

  return (
    <div className="space-y-6 p-6">
      {/* ===== 批 E（2026-09-03）：仓库负载面板（方案 Q12）+ 派单中心（方案 Q13） ===== */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('admin.warehouseLoad.title')}</h3>
        {/* P2-2 接线（2026-09-03）：预警卡「跨仓支援」→ 定位派单中心该仓 + 自动开跨仓确认 */}
        <WarehouseLoadPanel onCrossSupport={(warehouseId) => setCrossSupportTarget({ warehouseId, nonce: Date.now() })} />
      </section>

      <section className="space-y-3" id="dispatch-center">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('admin.dispatchCenter.title')}</h3>
          {/* 任务监控独立页批1（20261019）：老用户过渡兜底链接（监控区已抽迁 /dispatch/tasks） */}
          <Link
            href="/dispatch/tasks"
            className="inline-flex items-center gap-0.5 text-sm text-primary hover:underline"
          >
            {t('admin.dispatch.monitorLink')}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <DispatchCenter crossSupportTarget={crossSupportTarget} />
      </section>

      {/* ===== 保证金拦截链批C C1（2026-09-11）：派单排序权重可配（SystemConfig dispatch.score_weights） ===== */}
      <section className="space-y-3">
        <DispatchWeightsCard />
      </section>
    </div>
  );
}
