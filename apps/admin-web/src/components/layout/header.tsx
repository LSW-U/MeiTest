/**
 * Header — (dashboard) 顶部栏
 *
 * 组成：Logo/标题 + PerspectiveSwitcher + LanguageSwitcher + 通知占位
 *
 * W3-W 流程：W 流程独占，不写订单/骑手等菜单（其他流程 territory）
 */
import { Bell } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PerspectiveSwitcher } from '@/components/PerspectiveSwitcher';

export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-white px-6">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold">MeiMart</span>
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
          Admin
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="notifications"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <Bell className="h-4 w-4" />
        </button>
        <LanguageSwitcher />
        <PerspectiveSwitcher />
      </div>
    </header>
  );
}
