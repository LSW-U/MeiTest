/**
 * 骑手管理视角落地页（视角 rider-mgmt）
 *
 * MVP：占位首页 + 视角守卫
 * W3 接入骑手审核 / 班次管理（流程 C 独占）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PerspectiveGuard } from '@/components/PerspectiveGuard';

export default function RiderMgmtHomePage() {
  const t = useTranslations('platform');
  return (
    <PerspectiveGuard require="rider-mgmt">
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>
          {t('perspective.riderMgmt')}
        </h1>
        <p style={{ color: '#666', fontSize: 14 }}>
          {/* MVP placeholder; rider management pages land in W3 流程 C */}
          W3 流程 C 接入骑手审核、班次管理、抢单监控。
        </p>
      </div>
    </PerspectiveGuard>
  );
}
