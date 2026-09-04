'use client';

/**
 * UserMenu — Header 最右用户头像下拉
 *
 * 批次4 微调（2026-08-31）：替换原裸 LogOut 图标按钮。
 *
 * 后端现状：admin-web 登录响应 + JWT 均不含 name/email（MeController 仅测试用，
 * ProfileController 尚未建）。故头像用占位字母（首字母 A=Admin），下拉只放「退出登录」
 * 一项；待后端补 admin profile 端点后，再加「个人资料」项与真实姓名/邮箱展示。
 *
 * 登出逻辑不变（沿用原 LogoutButton）：
 *   - 调 POST /api/v1/common/auth/logout（apiFetch 自动 credentials:include + X-CSRF-Token）
 *   - 后端 clearAuthCookies（清 access/refresh/csrf cookie）+ revokeFamily
 *   - 前端清 admin_session 标志 + 跳 /login
 *   - 即使后端 logout 失败（refresh 已过期等），前端仍强制清 session 跳转（保证登出）
 */
import { LogOut, LayoutGrid, Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { apiFetch, setAuthenticated } from '@/lib/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu() {
  const t = useTranslations('auth');
  const tp = useTranslations('platform');
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      // mutate 请求 apiFetch 自动带 X-CSRF-Token（从 admin_csrf cookie 读）+ httpOnly cookie
      await apiFetch('/common/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {
      // 后端 logout 失败不阻塞前端登出（cookie 可能已被后端 clear，或 refresh 失效）
    } finally {
      setAuthenticated(false);
      window.location.href = '/login';
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full p-0"
          aria-label={t('logout.title')}
        >
          <Avatar className="h-8 w-8">
            {/* 后端无 name/email → 占位字母头像；待 profile 端点落地后替换为真实首字母 */}
            <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
              A
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>{tp('menu.account')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* 快捷入口：应用中心 / 系统设置（sidebar「系统」组已有，此处作常用快捷可达） */}
        <DropdownMenuItem asChild>
          <Link href="/apps" className="cursor-pointer">
            <LayoutGrid className="mr-2 h-4 w-4" />
            {tp('menu.apps')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <SettingsIcon className="mr-2 h-4 w-4" />
            {tp('menu.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout}
          disabled={loading}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {t('logout.title')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
