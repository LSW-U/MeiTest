/**
 * Sidebar — (dashboard) 左侧导航
 *
 * 设计：
 *   - 按当前 perspective 过滤可见菜单项
 *   - lucide-react 图标
 *   - 三流程菜单合并：Dashboard / Products / Categories / Warehouses（W 流程）
 *     + Orders（C 流程 admin 视角）+ Riders（C 流程 rider-mgmt 视角）
 *     + Settings（M 流程 platform 视角）+ 占位页 Customers / Promotions / Statistics
 *
 * 视角可见性：
 *   - platform：看全部菜单（W + C + M + 占位）
 *   - merchant：Products / Categories / Orders
 *   - warehouse：Warehouses / Orders
 *   - support：Orders（客服视角）
 *   - rider-mgmt：Riders
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Warehouse,
  ShoppingCart,
  Bike,
  Users,
  Tag,
  BarChart3,
  Settings,
} from 'lucide-react';
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
  {
    label: 'Orders',
    href: '/orders',
    icon: ShoppingCart,
    perspectives: ['platform', 'merchant', 'warehouse', 'support'],
  },
  {
    label: 'Riders',
    href: '/riders',
    icon: Bike,
    perspectives: ['platform', 'rider-mgmt'],
  },
  {
    label: 'Customers',
    href: '/customers',
    icon: Users,
    perspectives: ['platform'],
  },
  {
    label: 'Promotions',
    href: '/promotions',
    icon: Tag,
    perspectives: ['platform'],
  },
  {
    label: 'Statistics',
    href: '/statistics',
    icon: BarChart3,
    perspectives: ['platform'],
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    perspectives: ['platform'],
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
