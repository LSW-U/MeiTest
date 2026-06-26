/**
 * (legacy) 路由组 layout — 保留 W2 阶段的旧 header + nav 样式
 *
 * 用途：5 个视角占位页（platform/merchant/warehouse/support/rider-mgmt/shop）
 *      + 2 个 W2-W 写的旧 list 页（catalog/products, warehouse）
 *      未迁移到 (dashboard) 前继续用旧 UI。
 *
 * W3 W 流程：新的 catalog + warehouse CRUD 页面在 (dashboard)/ 下，使用 Sidebar + 新 Header。
 */
import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PerspectiveSwitcher } from '@/components/PerspectiveSwitcher';

export default function LegacyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <strong>MeiMart</strong>
          <nav className="flex gap-3 text-sm">
            <a href="/shop" className="text-blue-600 no-underline hover:underline">
              Shop
            </a>
            <a href="/warehouse" className="text-blue-600 no-underline hover:underline">
              Warehouse
            </a>
            <a href="/catalog/products" className="text-blue-600 no-underline hover:underline">
              Products
            </a>
            <a
              href="/products"
              className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 no-underline hover:bg-blue-100"
            >
              新 UI →
            </a>
            <a
              href="/warehouses"
              className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 no-underline hover:bg-blue-100"
            >
              新仓库 UI →
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <PerspectiveSwitcher />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
