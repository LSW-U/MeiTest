/**
 * Theme store（zustand + persist）
 *
 * admin-web 优化方案 批次3 3.4（2026-08-29）
 *
 * 轻量暗色模式：不加 next-themes 依赖，手写 zustand store + documentElement.classList + localStorage。
 * 设计参考 perspective.ts：name / createJSONStorage(localStorage) / onRehydrateStorage 校验 / partialize。
 *
 * 用法：
 *   const theme = useThemeStore(s => s.theme);
 *   const toggleTheme = useThemeStore(s => s.toggleTheme);
 *
 * store 只负责持久化 + 给 ThemeToggle 用，classList 的同步在 ThemeToggle 的 useEffect 里做
 * （store 本身在 SSR 无 document，避免在 create 顶层访问 document）。
 */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

const DEFAULT_THEME: Theme = 'light';

function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

interface ThemeState {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME,
      setTheme: (next) => set({ theme: next }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    }),
    {
      name: 'meimart.theme',
      storage: createJSONStorage(() => localStorage),
      /** 启动时校验持久化值合法（防 localStorage 被手改） */
      onRehydrateStorage: () => (state) => {
        if (state && !isTheme(state.theme)) {
          state.theme = DEFAULT_THEME;
        }
      },
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);

/**
 * 把 theme 同步到 <html> 的 classList（dark 类开关）。
 * 在 ThemeToggle / 布局客户端组件挂载时调用，避免 SSR 不匹配。
 */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
