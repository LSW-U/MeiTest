/**
 * Perspective 视角切换（admin-web 客户端）
 *
 * - 5 视角：platform / merchant / warehouse / support / rider-mgmt
 * - 持久化 localStorage（key: admin_perspective）
 * - 通过 X-Perspective header 传给后端审计用
 * - JWT 不含 perspective（决策 J）
 *
 * W2-W 流程 2026-06-24：admin-web 三流程都复用此模块
 */
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupportedLocale } from '@/i18n/config';

export type Perspective = 'platform' | 'merchant' | 'warehouse' | 'support' | 'rider-mgmt';

const STORAGE_KEY = 'admin_perspective';
const DEFAULT_PERSPECTIVE: Perspective = 'platform';

const PerspectiveLabels: Record<Perspective, Record<SupportedLocale, string>> = {
  platform: { en: 'Platform', zh: '平台', id: 'Platform', pt: 'Plataforma', tet: 'Platform' },
  merchant: { en: 'Merchant', zh: '商家', id: 'Pedagang', pt: 'Mercante', tet: 'Merchant' },
  warehouse: { en: 'Warehouse', zh: '仓库', id: 'Gudang', pt: 'Armazém', tet: 'Armazém' },
  support: { en: 'Support', zh: '客服', id: 'Dukungan', pt: 'Suporte', tet: 'Suporte' },
  'rider-mgmt': {
    en: 'Rider Mgmt',
    zh: '骑手管理',
    id: 'Manajemen Rider',
    pt: 'Gestão Riders',
    tet: 'Rider Mgmt',
  },
};

interface PerspectiveContextValue {
  perspective: Perspective;
  setPerspective: (p: Perspective) => void;
  label: (lang: SupportedLocale) => string;
}

const PerspectiveContext = createContext<PerspectiveContextValue | null>(null);

export function PerspectiveProvider({ children }: { children: ReactNode }) {
  const [perspective, setPerspectiveState] = useState<Perspective>(DEFAULT_PERSPECTIVE);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Perspective | null;
    if (saved && saved in PerspectiveLabels) {
      setPerspectiveState(saved);
    }
  }, []);

  const setPerspective = (p: Perspective) => {
    setPerspectiveState(p);
    localStorage.setItem(STORAGE_KEY, p);
  };

  const label = (lang: SupportedLocale) => PerspectiveLabels[perspective][lang];

  return (
    <PerspectiveContext.Provider value={{ perspective, setPerspective, label }}>
      {children}
    </PerspectiveContext.Provider>
  );
}

export function usePerspective(): PerspectiveContextValue {
  const ctx = useContext(PerspectiveContext);
  if (!ctx) {
    throw new Error('usePerspective must be used within PerspectiveProvider');
  }
  return ctx;
}

export const PERSPECTIVES = Object.keys(PerspectiveLabels) as Perspective[];
export const getPerspectiveLabel = (
  p: Perspective,
  lang: SupportedLocale,
): string => PerspectiveLabels[p][lang];
