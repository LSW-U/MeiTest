/**
 * Sidebar — (dashboard) 左侧导航
 *
 * 设计：
 *   - 8 组分组渲染：总览 / 商品 / 交易 / 履约 / 用户 / 营销 / 财务 / 系统
 *   - 组标题小字 + chevron，点击展开/收起；展开状态存 localStorage（admin_sidebar_groups）
 *   - 无该 key 时默认全展开；组内无可见项时不渲染组标题
 *   - 每个菜单项的 perspectives 数组保持不变（5 视角权限逻辑不动），分组层只做渲染包装
 *   - lucide-react 图标
 *   - 三流程菜单合并：Dashboard / Products / Categories / Warehouses（W 流程）
 *     + Orders（C 流程 admin 视角）+ Riders（C 流程 rider-mgmt 视角）
 *     + Settings（M 流程 platform 视角）+ 占位页 Customers / Promotions / Statistics
 *
 * 视角可见性：
 *   - platform：看全部菜单（W + C + M + 占位）→ 8 组全显
 *   - merchant：Products / Categories / Orders / Refunds / Reviews
 *   - warehouse：Warehouses / Orders / Inventory
 *   - support：Orders / Refunds / Reviews
 *   - rider-mgmt：Riders
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Warehouse,
  ShoppingCart,
  RotateCcw,
  MessageSquare,
  Bike,
  Users,
  Tag,
  BarChart3,
  Settings,
  Image,
  Flame,
  Wallet,
  Banknote,
  ScrollText,
  CreditCard,
  Truck,
  Boxes,
  Smartphone,
  Bell,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Store,
  Tags,
  Megaphone,
  Wallet as WalletIcon,
  Cog,
} from 'lucide-react';
import { usePerspectiveStore } from '@/stores/perspective';
import { cn } from '@/lib/utils';

interface NavItem {
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  perspectives: readonly string[];
}

/** 单个菜单项（perspectives 数组保持原样，分组层不参与权限） */
const NAV_ITEMS: NavItem[] = [
  {
    labelKey: 'menu.dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    perspectives: ['platform', 'merchant', 'warehouse'],
  },
  {
    labelKey: 'menu.products',
    href: '/products',
    icon: Package,
    perspectives: ['platform', 'merchant'],
  },
  {
    labelKey: 'menu.categories',
    href: '/categories',
    icon: FolderTree,
    perspectives: ['platform', 'merchant'],
  },
  {
    labelKey: 'menu.banners',
    href: '/banners',
    icon: Image,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.warehouses',
    href: '/warehouses',
    icon: Warehouse,
    perspectives: ['platform', 'warehouse'],
  },
  {
    labelKey: 'menu.orders',
    href: '/orders',
    icon: ShoppingCart,
    perspectives: ['platform', 'merchant', 'warehouse', 'support'],
  },
  {
    labelKey: 'menu.refunds',
    href: '/refunds',
    icon: RotateCcw,
    perspectives: ['platform', 'merchant', 'support'],
  },
  {
    labelKey: 'menu.reviews',
    href: '/reviews',
    icon: MessageSquare,
    perspectives: ['platform', 'merchant', 'support'],
  },
  {
    labelKey: 'menu.riders',
    href: '/riders',
    icon: Bike,
    perspectives: ['platform', 'rider-mgmt'],
  },
  {
    labelKey: 'menu.dispatch',
    href: '/dispatch',
    icon: Truck,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.inventory',
    href: '/inventory',
    icon: Boxes,
    perspectives: ['platform', 'warehouse'],
  },
  {
    labelKey: 'menu.customers',
    href: '/customers',
    icon: Users,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.promotions',
    href: '/promotions',
    icon: Tag,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.hotSearch',
    href: '/hot-search',
    icon: Flame,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.apps',
    href: '/apps',
    icon: Smartphone,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.feedback',
    href: '/feedback',
    icon: MessageSquare,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.notifications',
    href: '/notifications',
    icon: Bell,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.statistics',
    href: '/statistics',
    icon: BarChart3,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.settle',
    href: '/settlements',
    icon: Wallet,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.withdrawals',
    href: '/withdrawals',
    icon: Banknote,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.auditLogs',
    href: '/audit-logs',
    icon: ScrollText,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.payments',
    href: '/payments',
    icon: CreditCard,
    perspectives: ['platform'],
  },
  {
    labelKey: 'menu.settings',
    href: '/settings',
    icon: Settings,
    perspectives: ['platform'],
  },
];

/** 分组定义：8 组固定顺序，组 key 对应 localStorage 记忆键 */
interface NavGroup {
  /** 组标题 i18n key（platform namespace 下） */
  labelKey: string;
  /** 组 key，用于折叠状态记忆（admin_sidebar_groups） */
  groupKey: string;
  /** 组标题左侧图标 */
  icon: React.ComponentType<{ className?: string }>;
  /** 组内菜单项的 href 集合，按 href 匹配 NAV_ITEMS */
  hrefs: readonly string[];
}

const NAV_GROUPS: NavGroup[] = [
  { labelKey: 'menu.groupOverview', groupKey: 'groupOverview', icon: LayoutGrid, hrefs: ['/dashboard', '/statistics'] },
  { labelKey: 'menu.groupCatalog', groupKey: 'groupCatalog', icon: Store, hrefs: ['/products', '/categories', '/banners', '/hot-search'] },
  { labelKey: 'menu.groupTrade', groupKey: 'groupTrade', icon: Tags, hrefs: ['/orders', '/refunds', '/reviews', '/payments'] },
  { labelKey: 'menu.groupFulfillment', groupKey: 'groupFulfillment', icon: Truck, hrefs: ['/dispatch', '/riders', '/warehouses', '/inventory'] },
  { labelKey: 'menu.groupUsers', groupKey: 'groupUsers', icon: Users, hrefs: ['/customers'] },
  { labelKey: 'menu.groupMarketing', groupKey: 'groupMarketing', icon: Megaphone, hrefs: ['/promotions'] },
  { labelKey: 'menu.groupFinance', groupKey: 'groupFinance', icon: WalletIcon, hrefs: ['/settlements', '/withdrawals'] },
  { labelKey: 'menu.groupSystem', groupKey: 'groupSystem', icon: Cog, hrefs: ['/apps', '/feedback', '/notifications', '/settings', '/audit-logs'] },
];

/** 折叠状态记忆 key */
const SIDEBAR_GROUPS_STORAGE_KEY = 'admin_sidebar_groups';

export function Sidebar() {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const perspective = usePerspectiveStore((s) => s.perspective);

  // 折叠状态：true=展开（可见），false=收起；undefined=无 localStorage 记录（默认全展开）
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // 挂载时读 localStorage（SSR 安全：仅 client 端读，避免 hydration 不匹配）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_GROUPS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // 只采纳显式 boolean 值，其余丢弃；缺失的组视为展开（默认全展开语义）
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'boolean') next[k] = v;
        }
        setCollapsed(next);
      }
    } catch {
      // localStorage 被手改坏 JSON → 静默回退默认全展开
    }
    setHydrated(true);
  }, []);

  // 切换某组展开/收起并持久化
  const toggleGroup = (groupKey: string) => {
    setCollapsed((prev) => {
      // 默认全展开 → 当前展开（true/undefined）→ 收起（false）
      const isExpanded = prev[groupKey] !== false;
      const next = { ...prev, [groupKey]: !isExpanded };
      try {
        window.localStorage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 写入失败（隐私模式等）→ 仅内存生效，不持久化
      }
      return next;
    });
  };

  const visibleItems = NAV_ITEMS.filter((item) => item.perspectives.includes(perspective));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-white dark:bg-background">
      <nav className="flex-1 space-y-3 overflow-y-auto p-3">
        {NAV_GROUPS.map((group) => {
          const groupItems = visibleItems.filter((item) => group.hrefs.includes(item.href));
          // 组内无可见项 → 不渲染组标题（空组不出现）
          if (groupItems.length === 0) return null;
          // hydrated 前 / 无记录 → 默认展开；记录存在且为 false → 收起
          const isExpanded = !hydrated || collapsed[group.groupKey] !== false;
          const GroupChevron = isExpanded ? ChevronDown : ChevronRight;
          const GroupIcon = group.icon;
          return (
            <div key={group.groupKey} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.groupKey)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-base font-medium text-foreground hover:bg-accent"
                aria-expanded={isExpanded}
              >
                <GroupIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{t(group.labelKey)}</span>
                <GroupChevron className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
              {isExpanded &&
                groupItems.map((item) => {
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
                      <span>{t(item.labelKey)}</span>
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
