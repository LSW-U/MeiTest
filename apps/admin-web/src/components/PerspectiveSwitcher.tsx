/**
 * PerspectiveSwitcher — 顶部下拉切换器
 *
 * 决策依据：W-M-C-T 流程 3 W2 — platform M1 C2
 *
 * 切换时：
 *   - 更新 zustand store（persist 到 localStorage）
 *   - toast 确认（用 i18n 文案）
 *   - 跳转到对应视角首页（PERSPECTIVE_HOME）
 *   - reset 业务 state（避免脏数据 — 通过路由跳转天然完成）
 */
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePerspectiveStore } from '@/stores/perspective';
import {
  PERSPECTIVES,
  PERSPECTIVE_HOME,
  PERSPECTIVE_LABEL_KEY,
  type Perspective,
} from '@/lib/perspective';

export function PerspectiveSwitcher() {
  const t = useTranslations('platform');
  const router = useRouter();
  const perspective = usePerspectiveStore((s) => s.perspective);
  const setPerspective = usePerspectiveStore((s) => s.setPerspective);
  const [toast, setToast] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Perspective;
    setPerspective(next);
    const label = t(PERSPECTIVE_LABEL_KEY[next].replace('platform.perspective.', 'perspective.'));
    setToast(t('perspective.switchedToast', { name: label }));
    router.push(PERSPECTIVE_HOME[next]);
    setTimeout(() => setToast(null), 2500);
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, position: 'relative' }}>
      <label
        htmlFor="perspective-select"
        style={{ fontSize: 13, color: '#666' }}
      >
        {t('perspective.label')}
      </label>
      <select
        id="perspective-select"
        value={perspective}
        onChange={onChange}
        style={{
          padding: '6px 10px',
          border: '1px solid #d5d5d5',
          borderRadius: 4,
          background: 'white',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {PERSPECTIVES.map((p) => (
          <option key={p} value={p}>
            {t(PERSPECTIVE_LABEL_KEY[p].replace('platform.perspective.', 'perspective.'))}
          </option>
        ))}
      </select>
      {toast && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            padding: '8px 12px',
            background: '#1a5dc2',
            color: 'white',
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
