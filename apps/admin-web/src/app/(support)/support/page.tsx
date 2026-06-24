/**
 * 客服视角落地页（视角 support）
 *
 * MVP：占位首页 + 视角守卫
 * W3 接入 IM 会话（流程 M 独占路由组 /im）
 */
'use client';

import { useTranslations } from 'next-intl';
import { PerspectiveGuard } from '@/components/PerspectiveGuard';

export default function SupportHomePage() {
  const t = useTranslations('platform');
  return (
    <PerspectiveGuard require="support">
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>
          {t('perspective.support')}
        </h1>
        <p style={{ color: '#666', fontSize: 14 }}>
          {/* MVP placeholder; IM conversation pages land in W3 流程 M (/im) */}
          W3 流程 M 接入 IM 三方会话（客户↔商家/骑手/客服）。
        </p>
      </div>
    </PerspectiveGuard>
  );
}
