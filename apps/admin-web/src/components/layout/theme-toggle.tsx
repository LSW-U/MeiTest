/**
 * ThemeToggle — 暗色模式切换按钮（Header 用）
 *
 * admin-web 优化方案 批次3 3.4（2026-08-29）
 *
 * 轻量实现：zustand useThemeStore 持久化 + documentElement.classList('dark') + localStorage。
 * 不依赖 next-themes。
 *
 * SSR 注意：挂载后才读 store 值并同步 classList，避免 hydration 不匹配。
 * 初始渲染按 light 渲染图标（按钮始终可点，挂载后 effect 会纠正 classList 与图标）。
 */
'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useThemeStore, applyThemeToDocument, type Theme } from '@/stores/theme';

export function ThemeToggle() {
  const t = useTranslations('common');
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  // 挂载标志：store 持久化值在客户端首次渲染后才就绪，避免 SSR 不匹配
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    applyThemeToDocument(theme);
  }, [theme]);

  const current: Theme = mounted ? theme : 'light';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('theme.toggle')}
      title={t('theme.toggle')}
      onClick={() => toggleTheme()}
    >
      {current === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
