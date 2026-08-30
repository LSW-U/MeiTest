/**
 * PerspectiveSwitcher — 顶部下拉切换器（图标按钮 + DropdownMenu）
 *
 * 决策依据：W-M-C-T 流程 3 W2 — platform M1 C2
 * 与 LanguageSwitcher 保持一致的交互形态：固定宽度图标按钮，点击弹 dropdown 选择。
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
import { Eye } from 'lucide-react';
import { usePerspectiveStore } from '@/stores/perspective';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PERSPECTIVES,
  PERSPECTIVE_HOME,
  PERSPECTIVE_LABEL_KEY,
  type Perspective,
} from '@/lib/perspective';

/** 把 platform.perspective.xxx key 转成 perspective.xxx（当前 namespace 已是 platform，去掉前缀） */
function labelKey(p: Perspective) {
  return PERSPECTIVE_LABEL_KEY[p].replace('platform.perspective.', 'perspective.');
}

export function PerspectiveSwitcher() {
  const t = useTranslations('platform');
  const router = useRouter();
  const perspective = usePerspectiveStore((s) => s.perspective);
  const setPerspective = usePerspectiveStore((s) => s.setPerspective);
  const [toast, setToast] = useState<string | null>(null);

  /** 切换视角：更新 store + toast + 跳转视角首页，dropdown 自动收起 */
  function onChange(next: string) {
    const nextPerspective = next as Perspective;
    if (nextPerspective === perspective) return;
    setPerspective(nextPerspective);
    const label = t(labelKey(nextPerspective));
    setToast(t('perspective.switchedToast', { name: label }));
    router.push(PERSPECTIVE_HOME[nextPerspective]);
    setTimeout(() => setToast(null), 2500);
  }

  return (
    <div className="relative inline-flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('perspective.label')}
            className="h-9 w-9"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={perspective} onValueChange={onChange}>
            {PERSPECTIVES.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                {t(labelKey(p))}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {toast && (
        <div
          role="status"
          className="absolute right-0 top-full mt-2 whitespace-nowrap rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground shadow-md"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
