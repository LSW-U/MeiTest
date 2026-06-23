/**
 * 商家视角落地页（视角 merchant）
 *
 * MVP：占位首页 + 视角守卫
 * W3 接入商品管理 / 订单管理（流程 W 独占路由组）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PerspectiveGuard } from '@/components/PerspectiveGuard';

export default function MerchantHomePage() {
  const t = useTranslations('platform');
  return (
    <PerspectiveGuard require="merchant">
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>
          {t('perspective.merchant')}
        </h1>
        <p style={{ color: '#666', fontSize: 14 }}>
          {/* MVP placeholder; merchant product/order pages land in W3 流程 W */}
          W3 流程 W 接入商品管理、订单管理、库存调整。
        </p>
      </div>
    </PerspectiveGuard>
  );
}
