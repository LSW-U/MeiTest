/**
 * 仓库视角落地页（视角 warehouse）
 *
 * MVP：占位首页 + 视角守卫
 * W3 接入库存管理 / 订单履约（流程 W 独占路由组）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PerspectiveGuard } from '@/components/PerspectiveGuard';

export default function WarehouseHomePage() {
  const t = useTranslations('platform');
  return (
    <PerspectiveGuard require="warehouse">
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>
          {t('perspective.warehouse')}
        </h1>
        <p style={{ color: '#666', fontSize: 14 }}>
          {/* MVP placeholder; warehouse stock/order-fulfillment pages land in W3 流程 W */}
          W3 流程 W 接入库存管理、订单履约、配送调度。
        </p>
      </div>
    </PerspectiveGuard>
  );
}
