/**
 * 仪表盘首页（(dashboard)/page.tsx）
 *
 * MVP 简化版：4 个统计卡片占位 + 视角说明。
 * W3 W 流程不实现具体统计 API（M 流程 platform 模块 territory），
 * 占位卡片展示 W 流程相关数据（商品数 / 仓库数 / 分类数）。
 */
'use client';

import { useTranslations } from 'next-intl';
import { Package, Warehouse, FolderTree, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useProducts } from '@/hooks/api/use-products';
import { useCategories } from '@/hooks/api/use-categories';
import { useWarehouses } from '@/hooks/api/use-warehouses';
import { usePerspectiveStore } from '@/stores/perspective';

export default function DashboardPage() {
  const t = useTranslations();
  const perspective = usePerspectiveStore((s) => s.perspective);
  const productsQ = useProducts();
  const categoriesQ = useCategories();
  const warehousesQ = useWarehouses();

  const stats = [
    {
      label: 'Products',
      value: Array.isArray(productsQ.data?.data) ? productsQ.data.data.length : 0,
      icon: Package,
      color: 'text-orange-600',
      loading: productsQ.isLoading,
    },
    {
      label: 'Categories',
      value: categoriesQ.data?.data ? categoriesQ.data.data.length : 0,
      icon: FolderTree,
      color: 'text-blue-600',
      loading: categoriesQ.isLoading,
    },
    {
      label: 'Warehouses',
      value: warehousesQ.data?.data ? warehousesQ.data.data.length : 0,
      icon: Warehouse,
      color: 'text-green-600',
      loading: warehousesQ.isLoading,
    },
    {
      label: 'Today Orders',
      value: '—',
      icon: ShoppingCart,
      color: 'text-purple-600',
      loading: false,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('w.dashboard.title') as string}
        description={`Perspective: ${perspective}`}
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                {stat.loading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <div className="text-2xl font-bold">{stat.value}</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-medium">W3-W flow 收尾进行中</p>
        <p className="mt-1 text-blue-800">
          Catalog 客户端浏览页 + M1 warehouse 模块收尾。订单/客户/促销/统计等数据看板归 M 流程 platform
          模块，本页只展示 W 流程相关数据。
        </p>
      </div>
    </>
  );
}
