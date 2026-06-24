/**
 * 视角切换器（admin-web 顶部下拉）
 *
 * W2-W 流程 2026-06-24：admin-web 三流程复用
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { PERSPECTIVES, usePerspective, getPerspectiveLabel, type Perspective } from '@/lib/perspective';
import type { SupportedLocale } from '@/i18n/config';

export function PerspectiveSwitcher() {
  const { perspective, setPerspective } = usePerspective();
  const locale = useLocale() as SupportedLocale;
  const t = useTranslations('common');

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14,
      }}
    >
      <span style={{ color: '#666' }}>{t('w.perspective.title')}:</span>
      <select
        value={perspective}
        onChange={(e) => setPerspective(e.target.value as Perspective)}
        style={{
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #ccc',
          background: 'white',
        }}
      >
        {PERSPECTIVES.map((p) => (
          <option key={p} value={p}>
            {getPerspectiveLabel(p, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
