/**
 * Sidebar — (dashboard) 左侧导航
 *
 * 设计：
 *   - 按当前 perspective 过滤可见菜单项
 *   - lucide-react 图标
 *   - W 流程只放 W 流程相关菜单（Dashboard / Products / Categories / Warehouses）
 *     订单/骑手/促销/结算 等菜单归其他流程，不在此处
 *
 * 视角可见性：
 *   - platform：看全部 W 流程菜单（可看全平台商品/仓库）
 *   - merchant：看 Products / Categories（管自己商品）
 *   - warehouse：看 Warehouses（管本仓库存）
 *   - support / rider-mgmt：W 流程菜单不可见（不是本视角职责）
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Package, FolderTree, Warehouse } from 'lucide-react';
import { usePerspectiveStore } from '@/stores/perspective';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  perspectives: readonly string[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    perspectives: ['platform', 'merchant', 'warehouse'],
  },
  {
    label: 'Products',
    href: '/products',
    icon: Package,
    perspectives: ['platform', 'merchant'],
  },
  {
    label: 'Categories',
    href: '/categories',
    icon: FolderTree,
    perspectives: ['platform', 'merchant'],
  },
  {
    label: 'Warehouses',
    href: '/warehouses',
    icon: Warehouse,
    perspectives: ['platform', 'warehouse'],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const perspective = usePerspectiveStore((s) => s.perspective);

  const visibleItems = NAV_ITEMS.filter((item) => item.perspectives.includes(perspective));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-white">
      <nav className="flex-1 space-y-1 p-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3 text-xs text-muted-foreground">
        <p>
          Perspective: <span className="font-medium text-foreground">{perspective}</span>
        </p>
        <p className="mt-1">W3-W flow</p>
      </div>
    </aside>
  );
}
