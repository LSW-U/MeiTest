/**
 * Perspective store（zustand + persist）
 *
 * 决策依据：CLAUDE.md §视角切换（zustand state 持久化 perspective，localStorage）
 *
 * 用法：
 *   const perspective = usePerspectiveStore(s => s.perspective);
 *   const setPerspective = usePerspectiveStore(s => s.setPerspective);
 *
 * 切换视角时调用 setPerspective，会同步：
 *   - localStorage（zustand persist 自动）
 *   - fetch wrapper 自动注入 X-Perspective header（见 lib/fetch.ts）
 *   - 路由跳转到对应首页（由 PerspectiveSwitcher 组件负责）
 */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  DEFAULT_PERSPECTIVE,
  isPerspective,
  type Perspective,
} from '@/lib/perspective';

interface PerspectiveState {
  perspective: Perspective;
  setPerspective: (next: Perspective) => void;
}

export const usePerspectiveStore = create<PerspectiveState>()(
  persist(
    (set) => ({
      perspective: DEFAULT_PERSPECTIVE,
      setPerspective: (next) => set({ perspective: next }),
    }),
    {
      name: 'meimart.perspective',
      storage: createJSONStorage(() => localStorage),
      /** 启动时校验持久化值仍是合法视角（防 localStorage 被手改） */
      onRehydrateStorage: () => (state) => {
        if (state && !isPerspective(state.perspective)) {
          state.perspective = DEFAULT_PERSPECTIVE;
        }
      },
      partialize: (state) => ({ perspective: state.perspective }),
    },
  ),
);
