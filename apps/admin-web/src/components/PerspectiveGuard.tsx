/**
 * PerspectiveGuard — 客户端路由守卫
 *
 * 决策依据：W-M-C-T 流程 3 W2 — platform M1 C2
 *   - 路由守卫按视角控制（无权视角 → 跳默认视角）
 *
 * 用法：
 *   <PerspectiveGuard require="platform">
 *     {children}
 *   </PerspectiveGuard>
 *
 * 实现：客户端组件，挂载后从 zustand store 读 perspective，
 *      不匹配则 router.replace 到当前 perspective 首页。
 *
 * 注意：这仅是 UX 优化（避免用户看到错误菜单），不构成安全边界 —
 *      后端 RBAC 不感知 perspective，数据权限由 role 兜底。
 */
'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { usePerspectiveStore } from '@/stores/perspective';
import { PERSPECTIVE_HOME, type Perspective } from '@/lib/perspective';

interface Props {
  require: Perspective;
  children: ReactNode;
}

export function PerspectiveGuard({ require, children }: Props) {
  const perspective = usePerspectiveStore((s) => s.perspective);
  const setPerspective = usePerspectiveStore((s) => s.setPerspective);
  const router = useRouter();

  useEffect(() => {
    if (perspective !== require) {
      /** 当前视角不匹配，跳到当前视角首页（避免用户看到无效菜单） */
      router.replace(PERSPECTIVE_HOME[perspective]);
    }
  }, [perspective, require, router, setPerspective]);

  if (perspective !== require) return null;
  return <>{children}</>;
}
