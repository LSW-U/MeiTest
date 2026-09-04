/**
 * (dashboard) 路由组 layout — Header 顶栏 + 下方 Sidebar + Content 两栏
 *
 * 布局结构（经典后台）：
 *   - Header 横跨顶部全宽（MeiMart logo + 视角/语言切换 + 铃铛）
 *   - 下方一行：Sidebar 左侧 + main 内容右侧
 * - PerspectiveGuard 不套这一层（用户可能在 5 视角间切换）
 *   由具体页面（如 /products）的子组件判断视角权限
 * - 使用 flex h-screen overflow-hidden 防止整页滚动
 *
 * W3-W 流程：所有新 catalog/warehouse CRUD 页面在此路由组下
 */
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
