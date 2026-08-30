/**
 * Header — (dashboard) 顶部栏
 *
 * 组成：Logo/标题 + ThemeToggle + NotificationBell + LanguageSwitcher + PerspectiveSwitcher + UserMenu
 *
 * W3-W 流程：W 流程独占，不写订单/骑手等菜单（其他流程 territory）
 */
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PerspectiveSwitcher } from '@/components/PerspectiveSwitcher';
import { UserMenu } from '@/components/layout/user-menu';
import { NotificationBell } from '@/components/layout/notification-bell';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-white px-6 dark:bg-background">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold">MeiMart</span>
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          Admin
        </span>
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <NotificationBell />
        <LanguageSwitcher />
        <PerspectiveSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
