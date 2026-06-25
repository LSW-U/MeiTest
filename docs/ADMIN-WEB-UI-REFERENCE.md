# MeiMart Admin-Web UI 参考说明

> **给 Claude Code 的指令文档**：本文档是 admin-web 前端 UI 页面开发的唯一参考标准。开发任何 admin-web 页面之前必须通读本文档。
>
> 来源：medusa(34.6k⭐) + mall(83.9k⭐) + 6amMart + litemall(20.3k⭐) 四个开源项目深度分析提炼。

---

## 0. 现状诊断

### 当前 admin-web 状态（2026-06-24 HEAD）

```
apps/admin-web/src/
├── app/
│   ├── (catalog)/catalog/products/page.tsx     ← 裸 HTML table + 内联样式
│   ├── (merchant)/merchant/page.tsx            ← 占位页
│   ├── (merchant)/orders/page.tsx              ← 占位页
│   ├── (platform)/platform/page.tsx            ← 占位页
│   ├── (rider-mgmt)/rider-mgmt/page.tsx        ← 占位页
│   ├── (shop)/shop/page.tsx                    ← 占位页
│   ├── (support)/support/page.tsx              ← 占位页
│   ├── (warehouse)/warehouse/page.tsx          ← 占位页
│   ├── login/page.tsx                          ← 登录页
│   ├── layout.tsx                              ← 顶部 header + 内联样式 nav
│   └── page.tsx                                ← 首页跳转
├── components/
│   ├── LanguageSwitcher.tsx
│   ├── PerspectiveGuard.tsx
│   └── PerspectiveSwitcher.tsx
├── i18n/
│   ├── config.ts
│   └── request.ts
├── lib/
│   ├── api.ts                                  ← apiFetch wrapper（已完成，勿改）
│   ├── fetch.ts
│   └── perspective.ts
└── stores/
    └── perspective.ts                          ← Zustand perspective store
```

### 核心问题

1. **shadcn/ui 未安装**：CLAUDE.md 技术栈锁定 shadcn/ui，但 package.json 里没有 tailwind、没有 shadcn 依赖
2. **无布局系统**：layout.tsx 用内联样式写 header + a 标签导航，没有侧边栏
3. **无组件库**：products/page.tsx 用裸 `<table>` + 内联样式，没有 DataTable、Button、Input 等基础组件
4. **无 API Hooks 层**：每个页面直接调 `apiFetch`，没有按领域组织的 React Query hooks
5. **packages/ui-kit 是空壳**：只有一个 `export {}`

### 技术栈（CLAUDE.md 锁定，不可更改）

```
Next.js 14 (App Router) + shadcn/ui + next-intl + Zustand
i18n: en / id / zh / pt + Tetum 留接口
5 视角: platform / merchant / warehouse / support / rider-mgmt
API: NestJS 后端，apiFetch wrapper（已实现，自动注入 Authorization + X-Perspective + Accept-Language）
```

---

## 1. 布局系统 — 参考 medusa dashboard

### 1.1 目标布局结构

```
┌─────────────────────────────────────────────────────┐
│ Header（顶部栏）                                      │
│  [Logo] [全局搜索]     [视角切换] [语言] [通知] [头像] │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ Sidebar  │  Main Content Area                       │
│ (左侧栏)  │                                          │
│          │  ┌────────────────────────────────────┐  │
│ ▸ 仪表盘  │  │ Page Header                        │  │
│ ▸ 商品    │  │ [标题] [面包屑] [操作按钮]          │  │
│   - 列表  │  ├────────────────────────────────────┤  │
│   - 分类  │  │                                    │  │
│   - 品牌  │  │ Page Content                       │  │
│ ▸ 订单    │  │ (DataTable / Form / Dashboard)     │  │
│   - 全部  │  │                                    │  │
│   - 待处理│  │                                    │  │
│ ▸ 会员    │  └────────────────────────────────────┘  │
│ ▸ 配送    │                                          │
│ ▸ 营销    │                                          │
│ ▸ 统计    │                                          │
│ ▸ 设置    │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### 1.2 实现方案

**参考 medusa 的 `providers/sidebar-provider/` + `components/layout/`**

```
apps/admin-web/src/
├── app/
│   ├── (dashboard)/                         ← 新增路由组，带 sidebar 布局
│   │   ├── layout.tsx                       ← DashboardLayout（sidebar + header + content）
│   │   ├── page.tsx                         ← 仪表盘首页（从旧 page.tsx 迁移）
│   │   ├── products/
│   │   │   ├── page.tsx                     ← 商品列表
│   │   │   ├── [id]/page.tsx                ← 商品详情/编辑
│   │   │   └── create/page.tsx              ← 新建商品
│   │   ├── orders/
│   │   │   ├── page.tsx                     ← 订单列表
│   │   │   └── [id]/page.tsx                ← 订单详情
│   │   ├── customers/
│   │   │   └── page.tsx                     ← 客户列表
│   │   ├── riders/
│   │   │   ├── page.tsx                     ← 骑手列表
│   │   │   └── [id]/page.tsx                ← 骑手详情
│   │   ├── promotions/
│   │   │   └── page.tsx                     ← 促销列表
│   │   ├── statistics/
│   │   │   └── page.tsx                     ← 数据统计
│   │   └── settings/
│   │       └── page.tsx                     ← 系统设置
│   ├── login/page.tsx                       ← 登录页（独立布局，不套 dashboard）
│   └── layout.tsx                           ← RootLayout（只放 NextIntlClientProvider）
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx                      ← 左侧导航栏（可折叠）
│   │   ├── sidebar-item.tsx                 ← 导航项（支持子菜单折叠）
│   │   ├── header.tsx                       ← 顶部栏
│   │   ├── page-header.tsx                  ← 页面标题区（标题+面包屑+操作按钮）
│   │   └── breadcrumb.tsx                   ← 面包屑导航
│   ├── data-table/
│   │   ├── data-table.tsx                   ← 通用数据表格（参考 medusa blocks/data-table）
│   │   ├── data-table-column-header.tsx     ← 可排序的列头
│   │   ├── data-table-row-actions.tsx       ← 行操作按钮
│   │   ├── data-table-pagination.tsx        ← 分页器
│   │   └── data-table-toolbar.tsx           ← 搜索+筛选工具栏
│   ├── forms/
│   │   ├── form-field.tsx                   ← 表单字段容器（label + error + hint）
│   │   ├── form-section.tsx                 ← 表单分区（卡片内多字段分组）
│   │   └── form-actions.tsx                 ← 表单操作按钮区（保存/取消）
│   └── common/
│       ├── empty-state.tsx                  ← 空状态
│       ├── error-state.tsx                  ← 错误状态
│       ├── loading-skeleton.tsx             ← 骨架屏
│       └── status-badge.tsx                 ← 状态徽章（订单状态/商品状态等）
```

### 1.3 layout.tsx 改造

```tsx
// apps/admin-web/src/app/layout.tsx — RootLayout（精简，只做 Provider 组装）
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50 antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

```tsx
// apps/admin-web/src/app/(dashboard)/layout.tsx — DashboardLayout
import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PerspectiveGuard } from '@/components/PerspectiveGuard';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PerspectiveGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </PerspectiveGuard>
  );
}
```

---

## 2. shadcn/ui 安装与配置

### 2.1 依赖安装（需要用户确认后执行）

```bash
# 在 apps/admin-web 目录下
pnpm --filter @meimart/admin-web add tailwindcss @tailwindcss/postcss postcss
pnpm --filter @meimart/admin-web add class-variance-authority clsx tailwind-merge lucide-react
pnpm --filter @meimart/admin-web add @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-toast @radix-ui/react-popover @radix-ui/react-checkbox @radix-ui/react-switch @radix-ui/react-separator @radix-ui/react-avatar @radix-ui/react-tooltip

# shadcn/ui init（不用 CLI，手动建配置文件）
```

### 2.2 配置文件

```json
// apps/admin-web/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    },
  },
  plugins: [],
};
export default config;
```

```css
/* apps/admin-web/src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --radius: 0.5rem;
  }
  .dark { /* 暗色主题变量 */ }
}
```

### 2.3 lib/utils.ts（shadcn/ui 必需）

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 2.4 基础组件清单（参考 medusa design-system 45+ 组件，MVP 只装这些）

按优先级分 3 批：

**P0 — 立即需要（布局 + 列表页）**：
- `button` — 按钮（variant: default/secondary/destructive/outline/ghost/link）
- `input` — 输入框
- `table` — 表格基础
- `card` — 卡片容器
- `badge` — 徽章（状态标签）
- `dropdown-menu` — 下拉菜单
- `separator` — 分隔线
- `skeleton` — 骨架屏
- `avatar` — 头像
- `tabs` — 标签页

**P1 — 表单页需要**：
- `label` — 表单标签
- `select` — 下拉选择
- `checkbox` — 复选框
- `switch` — 开关
- `textarea` — 多行输入
- `dialog` — 弹窗
- `form` — 表单容器（react-hook-form 集成）
- `popover` — 气泡
- `tooltip` — 提示

**P2 — 增强体验**：
- `toast` — 消息提示
- `command` — 命令面板（全局搜索）
- `calendar` + `date-picker` — 日期选择
- `pagination` — 分页

---

## 3. 页面模板 — 每种页面的标准写法

### 3.1 列表页模板（参考 medusa `routes/products/product-list/` + mall `PmsProductController`）

```tsx
// 模板：apps/admin-web/src/app/(dashboard)/products/page.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/hooks/api/use-products';
// ↑ 参考 medusa 的 hooks/api/products.tsx 模式：每个领域实体一个 hooks 文件

export default function ProductsListPage() {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // React Query hook（参考 medusa hooks/api/ 模式）
  const { data, isLoading, error } = useProducts({ page, search });

  const columns = [
    { key: 'mainImage', header: t('common.image'), render: (row) => <img src={row.mainImage} className="h-10 w-10 rounded object-cover" /> },
    { key: 'name', header: t('common.name'), render: (row) => row.name?.en ?? '—' },
    { key: 'priceMin', header: t('common.price'), render: (row) => `$${(row.priceMin / 100).toFixed(2)}` },
    { key: 'salesCount', header: t('common.sales'), render: (row) => row.salesCount },
    { key: 'status', header: t('common.status'), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={t('products.title')}
        action={
          <Button asChild>
            <a href="/products/create"><Plus className="mr-2 h-4 w-4" />{t('products.create')}</a>
          </Button>
        }
      />
      <DataTable
        data={data?.items ?? []}
        columns={columns}
        isLoading={isLoading}
        toolbar={<DataTableToolbar searchValue={search} onSearchChange={setSearch} />}
        pagination={<DataTablePagination page={page} totalPages={data?.totalPages ?? 1} onPageChange={setPage} />}
        emptyState={<EmptyState message={t('products.empty')} />}
        errorState={error ? <ErrorState message={error.message} /> : null}
      />
    </>
  );
}
```

**关键模式（从 medusa 提炼）**：
- `PageHeader` 统一页面标题区，支持 action 按钮
- `DataTable` 是组合式组件：data + columns + toolbar + pagination + emptyState/errorState
- 列定义用 `render` 函数，不写 JSX 模板字符串
- 用 React Query hooks（`useProducts`），不直接调 `apiFetch`

### 3.2 详情页模板（参考 medusa `routes/orders/order-detail/`）

```tsx
// 模板：apps/admin-web/src/app/(dashboard)/orders/[id]/page.tsx
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrder } from '@/hooks/api/use-orders';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const t = useTranslations();
  const { data: order, isLoading } = useOrder(params.id);

  if (isLoading) return <LoadingSkeleton lines={8} />;

  return (
    <>
      <PageHeader
        title={`${t('orders.title')} #${order?.orderNo ?? ''}`}
        breadcrumb={[{ label: t('orders.title'), href: '/orders' }, { label: order?.orderNo ?? '' }]}
        action={
          <div className="flex gap-2">
            <Button variant="outline">{t('common.print')}</Button>
            <Button variant="destructive">{t('orders.cancel')}</Button>
          </div>
        }
      />
      <div className="grid gap-6 md:grid-cols-3">
        {/* 左侧 2/3 — 主信息 */}
        <div className="md:col-span-2 space-y-6">
          <Tabs defaultValue="items">
            <TabsList>
              <TabsTrigger value="items">{t('orders.tabs.items')}</TabsTrigger>
              <TabsTrigger value="timeline">{t('orders.tabs.timeline')}</TabsTrigger>
              <TabsTrigger value="logs">{t('orders.tabs.logs')}</TabsTrigger>
            </TabsList>
            <TabsContent value="items">
              <Card>
                <CardHeader><CardTitle>{t('orders.itemsTitle')}</CardTitle></CardHeader>
                <CardContent>
                  <DataTable data={order?.items ?? []} columns={orderItemColumns} />
                </CardContent>
              </Card>
            </TabsContent>
            {/* ... 其他 tab */}
          </Tabs>
        </div>
        {/* 右侧 1/3 — 侧边信息卡片 */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('orders.summary')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label={t('orders.status')} value={<StatusBadge status={order?.status} />} />
              <InfoRow label={t('orders.total')} value={`$${(order?.totalCents / 100).toFixed(2)}`} />
              <InfoRow label={t('orders.paymentMethod')} value={order?.paymentMethod} />
              <InfoRow label={t('orders.createdAt')} value={new Date(order?.createdAt).toLocaleString()} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('orders.customer')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label={t('common.name')} value={order?.customer?.name} />
              <InfoRow label={t('common.phone')} value={order?.customer?.phone} />
              <InfoRow label={t('orders.address')} value={order?.deliveryAddress} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
```

**关键模式**：
- 详情页用 `grid md:grid-cols-3` 布局，左 2/3 主信息 + 右 1/3 侧边卡片
- 用 `Tabs` 组件分隔不同信息区
- `Card` + `CardContent` + `InfoRow` 组成信息展示区
- `PageHeader` 支持 breadcrumb

### 3.3 表单页模板（参考 medusa `routes/products/product-create/`）

```tsx
// 模板：apps/admin-web/src/app/(dashboard)/products/create/page.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/forms/form-field';
import { FormSection } from '@/components/forms/form-section';
import { FormActions } from '@/components/forms/form-actions';
import { useCreateProduct } from '@/hooks/api/use-products';
import { useToast } from '@/components/ui/use-toast';

export default function CreateProductPage() {
  const t = useTranslations();
  const router = useRouter();
  const { toast } = useToast();
  const createProduct = useCreateProduct();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await createProduct.mutateAsync(Object.fromEntries(formData));
      toast({ title: t('common.saved') });
      router.push('/products');
    } catch (err) {
      toast({ title: t('common.error'), variant: 'destructive' });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PageHeader title={t('products.create')} />
      <FormSection title={t('products.sections.basic')}>
        <FormField label={t('products.nameEn')} required>
          <Input name="nameEn" required />
        </FormField>
        <FormField label={t('products.nameZh')}>
          <Input name="nameZh" />
        </FormField>
        <FormField label={t('products.sku')} required>
          <Input name="sku" required />
        </FormField>
        <FormField label={t('products.category')}>
          <Select name="categoryId">{/* options */}</Select>
        </FormField>
      </FormSection>
      <FormSection title={t('products.sections.pricing')}>
        <FormField label={t('products.price')} required hint={t('products.priceHint')}>
          <Input name="priceCents" type="number" required />
        </FormField>
      </FormSection>
      <FormActions>
        <Button type="button" variant="outline" onClick={() => router.back()}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={createProduct.isPending}>{t('common.save')}</Button>
      </FormActions>
    </form>
  );
}
```

**关键模式**：
- `FormSection` = Card 内的字段分组（基本信息 / 价格信息 / 库存信息 / 图片等）
- `FormField` = label + input + hint + error 的统一容器
- `FormActions` = 底部按钮区（取消 + 保存）
- 用 `useToast` 反馈操作结果，不用 alert
- 表单提交用 mutate（React Query mutation）

### 3.4 仪表盘首页模板（参考 medusa `routes/home/` + mall 统计报表）

```tsx
// 模板：apps/admin-web/src/app/(dashboard)/page.tsx
'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardStats } from '@/hooks/api/use-dashboard';
import { DollarSign, ShoppingCart, Users, Package } from 'lucide-react';

export default function DashboardPage() {
  const t = useTranslations();
  const { data, isLoading } = useDashboardStats();

  const stats = [
    { label: t('dashboard.todayRevenue'), value: `$${(data?.todayRevenueCents ?? 0 / 100).toFixed(2)}`, icon: DollarSign, color: 'text-green-600' },
    { label: t('dashboard.todayOrders'), value: data?.todayOrders ?? 0, icon: ShoppingCart, color: 'text-blue-600' },
    { label: t('dashboard.totalCustomers'), value: data?.totalCustomers ?? 0, icon: Users, color: 'text-purple-600' },
    { label: t('dashboard.totalProducts'), value: data?.totalProducts ?? 0, icon: Package, color: 'text-orange-600' },
  ];

  return (
    <>
      <PageHeader title={t('dashboard.title')} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* 可加图表区域：最近7天订单趋势 / 热销商品 Top 10 */}
    </>
  );
}
```

---

## 4. API Hooks 层 — 参考 medusa `hooks/api/`

### 4.1 目录结构

```
apps/admin-web/src/hooks/
├── api/
│   ├── use-products.ts       ← 商品 CRUD
│   ├── use-orders.ts         ← 订单 CRUD + 状态流转
│   ├── use-customers.ts      ← 客户列表/详情
│   ├── use-riders.ts         ← 骑手列表/详情/状态
│   ├── use-categories.ts     ← 分类树
│   ├── use-promotions.ts     ← 促销活动
│   ├── use-dashboard.ts      ← 仪表盘统计
│   ├── use-warehouses.ts     ← 仓库管理
│   └── use-settings.ts       ← 系统设置
└── use-debounced-search.ts   ← 防抖搜索
```

### 4.2 标准 hook 写法

```ts
// hooks/api/use-products.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

interface Product { id: string; name: Record<string, string>; status: string; priceMin: number; }
interface ProductListResponse { items: Product[]; total: number; page: number; totalPages: number; }

/** 商品列表 */
export function useProducts(params: { page?: number; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.search) query.set('search', params.search);
  return useQuery({
    queryKey: ['products', params],
    queryFn: () => apiFetch<ApiSuccess<ProductListResponse>>(`/admin/products?${query}`),
  });
}

/** 商品详情 */
export function useProduct(id: string) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => apiFetch<ApiSuccess<Product>>(`/admin/products/${id}`),
    enabled: !!id,
  });
}

/** 创建商品 */
export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Product>) =>
      apiFetch<ApiSuccess<Product>>('/admin/products', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

/** 更新商品状态 */
export function useUpdateProductStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch<ApiSuccess<Product>>(`/admin/products/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}
```

**需要安装 react-query**：
```bash
pnpm --filter @meimart/admin-web add @tanstack/react-query
```

**QueryClientProvider 加到 RootLayout**：
```tsx
// app/layout.tsx 里加：
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const queryClient = new QueryClient();
// 在 NextIntlClientProvider 内层包 <QueryClientProvider client={queryClient}>
```

---

## 5. 侧边栏导航 — 按视角动态显示

### 5.1 导航菜单结构（参考 mall 9 大模块 + 6amMart 配送模块）

```tsx
// components/layout/sidebar.tsx
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Package, ShoppingCart, Users, Bike, Tag, BarChart3, Settings, Warehouse, Store } from 'lucide-react';
import { usePerspective } from '@/stores/perspective';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  perspectives: string[];  // 哪些视角可见
  children?: { label: string; href: string }[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'nav.dashboard', href: '/', icon: LayoutDashboard, perspectives: ['platform', 'merchant', 'warehouse', 'support', 'rider-mgmt'] },
  {
    label: 'nav.catalog', href: '/products', icon: Package, perspectives: ['platform', 'merchant'],
    children: [
      { label: 'nav.products', href: '/products' },
      { label: 'nav.categories', href: '/categories' },
      { label: 'nav.brands', href: '/brands' },
    ],
  },
  {
    label: 'nav.orders', href: '/orders', icon: ShoppingCart, perspectives: ['platform', 'merchant', 'warehouse', 'support'],
    children: [
      { label: 'nav.allOrders', href: '/orders' },
      { label: 'nav.pendingOrders', href: '/orders?status=pending' },
      { label: 'nav.deliveringOrders', href: '/orders?status=delivering' },
    ],
  },
  { label: 'nav.customers', href: '/customers', icon: Users, perspectives: ['platform', 'merchant', 'support'] },
  {
    label: 'nav.delivery', href: '/riders', icon: Bike, perspectives: ['platform', 'rider-mgmt', 'warehouse'],
    children: [
      { label: 'nav.riders', href: '/riders' },
      { label: 'nav.dispatch', href: '/dispatch' },
      { label: 'nav.routes', href: '/routes' },
    ],
  },
  { label: 'nav.warehouses', href: '/warehouses', icon: Warehouse, perspectives: ['platform', 'warehouse'] },
  { label: 'nav.promotions', href: '/promotions', icon: Tag, perspectives: ['platform', 'merchant'] },
  { label: 'nav.statistics', href: '/statistics', icon: BarChart3, perspectives: ['platform', 'merchant'] },
  { label: 'nav.settings', href: '/settings', icon: Settings, perspectives: ['platform'] },
];
```

### 5.2 视角过滤逻辑

```tsx
// 侧边栏渲染时根据当前视角过滤
const { perspective } = usePerspective();
const visibleItems = NAV_ITEMS.filter(item => item.perspectives.includes(perspective));
```

---

## 6. 业务模块页面清单 — 参考 mall 5 大子系统

### 6.1 PMS 商品管理系统（参考 mall PmsBrandController 等）

| 页面 | 路由 | 参考来源 | 功能 |
|------|------|---------|------|
| 商品列表 | `/products` | medusa product-list + mall PmsProduct | 分页列表 + 搜索 + 上下架 |
| 商品详情 | `/products/[id]` | medusa product-detail | 基本信息 + SKU 变体 + 图片 + 价格 |
| 新建商品 | `/products/create` | medusa product-create | 多 section 表单 |
| 分类管理 | `/categories` | medusa categories + mall PmsProductCategory | 树形分类 CRUD |
| 品牌管理 | `/brands` | mall PmsBrand | 品牌列表 + Logo 上传 |

### 6.2 OMS 订单管理系统（参考 mall OmsOrderController）

| 页面 | 路由 | 参考来源 | 功能 |
|------|------|---------|------|
| 订单列表 | `/orders` | medusa order-list + mall OmsOrder | 多 tab（全部/待处理/配送中/已完成/已取消）+ 搜索 |
| 订单详情 | `/orders/[id]` | medusa order-detail | 订单信息 + 商品明细 + 配送信息 + 时间线 + 操作日志 |
| 退货管理 | `/orders/returns` | mall OmsOrderReturnApply | 退货申请列表 + 审核 |
| 退货原因 | `/orders/return-reasons` | mall OmsOrderReturnReason | 退货原因配置 |

### 6.3 UMS 用户管理系统

| 页面 | 路由 | 参考来源 | 功能 |
|------|------|---------|------|
| 客户列表 | `/customers` | medusa customers | 分页列表 + 搜索 |
| 客户详情 | `/customers/[id]` | medusa customer-detail | 基本信息 + 订单历史 + 消费统计 |

### 6.4 配送管理系统（参考 6amMart 骑手模块）

| 页面 | 路由 | 参考来源 | 功能 |
|------|------|---------|------|
| 骑手列表 | `/riders` | 6amMart delivery-man | 骑手列表 + 状态（在线/离线/配送中）+ 审核 |
| 骑手详情 | `/riders/[id]` | 6amMart delivery-man detail | 基本信息 + 配送记录 + 评分 + 收入统计 |
| 抢单大厅 | `/dispatch` | 6amMart dispatch | 待派送订单列表 + 手动指派骑手 |
| 配送路线 | `/routes` | 升鲜宝 物流模块 | 路线管理 + 车辆管理 |

### 6.5 SMS 营销管理系统（参考 mall SMS）

| 页面 | 路由 | 参考来源 | 功能 |
|------|------|---------|------|
| 促销列表 | `/promotions` | medusa promotions + mall SmsCoupon | 促销活动列表 |
| 优惠券 | `/promotions/coupons` | mall SmsCoupon | 优惠券 CRUD |

### 6.6 统计报表（参考 mall 统计报表 + 升鲜宝 数据报表）

| 页面 | 路由 | 参考来源 | 功能 |
|------|------|---------|------|
| 仪表盘 | `/` | medusa home | 今日营收/订单/客户/商品数 + 趋势图 |
| 销售报表 | `/statistics/sales` | mall 统计报表 | 日报/月报/自定义日期 |
| 商品报表 | `/statistics/products` | 升鲜宝 商品销售报表 | 热销商品 Top N + 报损报表 |

---

## 7. 页面迁移清单 — 从现有路由组迁移

### 7.1 迁移映射

| 现有路由 | 迁移目标 | 说明 |
|---------|---------|------|
| `(catalog)/catalog/products/page.tsx` | `(dashboard)/products/page.tsx` | 用 DataTable 替换裸 table |
| `(merchant)/merchant/page.tsx` | `(dashboard)/page.tsx` 或删除 | merchant 首页 = 仪表盘 |
| `(merchant)/orders/page.tsx` | `(dashboard)/orders/page.tsx` | 订单列表 |
| `(platform)/platform/page.tsx` | `(dashboard)/page.tsx` 或删除 | platform 首页 = 仪表盘 |
| `(rider-mgmt)/rider-mgmt/page.tsx` | `(dashboard)/riders/page.tsx` | 骑手列表 |
| `(shop)/shop/page.tsx` | `(dashboard)/shops/page.tsx` | 店铺管理（MVP 单店可简化） |
| `(support)/support/page.tsx` | `(dashboard)/support/page.tsx` | 客服工单（MVP 可后置） |
| `(warehouse)/warehouse/page.tsx` | `(dashboard)/warehouses/page.tsx` | 仓库列表 |
| `login/page.tsx` | `login/page.tsx`（不变） | 登录页独立布局 |

### 7.2 迁移原则

1. **废弃 Route Group 按视角分组的模式**：改为统一的 `(dashboard)` 路由组 + 侧边栏按视角动态过滤菜单项
2. **原因**：5 个视角共享同一套页面组件，只是菜单可见性和数据范围不同（后端通过 `X-Perspective` header 控制）。不需要 5 套独立的路由组
3. **layout.tsx 改造**：RootLayout 只做 Provider 组装；DashboardLayout 做 sidebar + header 布局

---

## 8. 通用组件规格

### 8.1 DataTable 组件 API（参考 medusa `blocks/data-table/`）

```tsx
interface DataTableProps<T> {
  data: T[];
  columns: Array<{
    key: string;
    header: string;
    render?: (row: T) => React.ReactNode;
    sortable?: boolean;
    className?: string;
  }>;
  isLoading?: boolean;
  toolbar?: React.ReactNode;        // 搜索框 + 筛选器
  pagination?: React.ReactNode;     // 分页器
  emptyState?: React.ReactNode;     // 空数据
  errorState?: React.ReactNode;     // 错误状态
  onRowClick?: (row: T) => void;    // 行点击跳转
  rowActions?: (row: T) => React.ReactNode; // 行操作按钮
}
```

### 8.2 StatusBadge 组件（参考 medusa `status-badge`）

```tsx
// 订单状态 → 颜色映射
const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PREPARING: 'bg-purple-100 text-purple-800',
  DELIVERING: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  // 商品状态
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
  OUT_OF_STOCK: 'bg-red-100 text-red-800',
};
```

### 8.3 PageHeader 组件 API

```tsx
interface PageHeaderProps {
  title: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  action?: React.ReactNode;  // 右侧操作按钮区
  description?: string;      // 标题下描述
}
```

---

## 9. i18n key 规划

### 9.1 namespace 结构（参考 medusa i18n translations/）

```json
// packages/shared-locales/en/admin.json
{
  "nav": {
    "dashboard": "Dashboard",
    "catalog": "Catalog",
    "products": "Products",
    "categories": "Categories",
    "brands": "Brands",
    "orders": "Orders",
    "customers": "Customers",
    "delivery": "Delivery",
    "riders": "Riders",
    "dispatch": "Dispatch",
    "warehouses": "Warehouses",
    "promotions": "Promotions",
    "statistics": "Statistics",
    "settings": "Settings"
  },
  "dashboard": {
    "title": "Dashboard",
    "todayRevenue": "Today's Revenue",
    "todayOrders": "Today's Orders",
    "totalCustomers": "Total Customers",
    "totalProducts": "Total Products"
  },
  "products": {
    "title": "Products",
    "create": "Create Product",
    "empty": "No products found",
    "sections": { "basic": "Basic Info", "pricing": "Pricing" },
    "nameEn": "Name (English)",
    "nameZh": "Name (Chinese)",
    "sku": "SKU",
    "price": "Price (USD)",
    "priceHint": "Enter price in cents",
    "category": "Category"
  },
  "orders": {
    "title": "Orders",
    "tabs": { "items": "Items", "timeline": "Timeline", "logs": "Logs" },
    "cancel": "Cancel Order",
    "itemsTitle": "Order Items",
    "summary": "Order Summary",
    "status": "Status",
    "total": "Total",
    "paymentMethod": "Payment Method",
    "createdAt": "Created At",
    "customer": "Customer",
    "address": "Delivery Address"
  },
  "common": {
    "image": "Image",
    "name": "Name",
    "price": "Price",
    "sales": "Sales",
    "status": "Status",
    "action": "Action",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "search": "Search",
    "print": "Print",
    "saved": "Saved successfully",
    "error": "An error occurred",
    "loading": "Loading..."
  }
}
```

---

## 10. 实施优先级

### Phase 1 — 基础设施（必须先做）

1. 安装 tailwind + shadcn/ui 依赖
2. 创建 `globals.css` + `tailwind.config.ts` + `lib/utils.ts`
3. 生成 P0 基础组件（button/input/table/card/badge/dropdown-menu/separator/skeleton/avatar/tabs）
4. 安装 `@tanstack/react-query`，在 layout.tsx 加 QueryClientProvider
5. 改造 `layout.tsx`（RootLayout 精简）+ 新建 `(dashboard)/layout.tsx`（sidebar + header）
6. 实现 `Sidebar` + `Header` + `PageHeader` 三个布局组件

### Phase 2 — 列表页迁移（替换现有裸 HTML）

7. 实现 `DataTable` + `DataTableToolbar` + `DataTablePagination` + `StatusBadge` + `EmptyState` + `ErrorState` + `LoadingSkeleton`
8. 创建 `hooks/api/use-products.ts`（第一个 API hook）
9. 迁移 `products/page.tsx`（从裸 table → DataTable + hooks）
10. 创建 `hooks/api/use-orders.ts`，迁移 `orders/page.tsx`

### Phase 3 — 详情页 + 表单页

11. 实现 `FormField` + `FormSection` + `FormActions`
12. 新建 `orders/[id]/page.tsx`（订单详情）
13. 新建 `products/create/page.tsx`（新建商品表单）
14. 新建 `riders/page.tsx`（骑手列表，参考 6amMart）

### Phase 4 — 仪表盘 + 统计

15. 创建 `hooks/api/use-dashboard.ts`
16. 新建仪表盘首页（统计卡片 + 图表占位）
17. 按需补充其他页面（customers/promotions/statistics/settings）

---

## 11. 参考项目链接速查

| 项目 | 链接 | 参考什么 |
|------|------|---------|
| **medusa** | https://github.com/medusajs/medusa | admin 路由结构、hooks/api/ 模式、DataTable 组件、Provider 组合、i18n 方案 |
| **medusa admin** | `packages/admin/dashboard/src/` | 35 个路由页面、45+ 设计系统组件 |
| **mall** | https://github.com/macrozheng/mall | PMS/OMS/CMS/SMS/UMS 业务模块、Controller 清单 |
| **mall-admin** | `mall-admin/src/main/java/com/macro/mall/controller/` | 后台 API 模块划分参考 |
| **6amMart** | https://github.com/blue0316/6amMart-others | 骑手管理、抢单大厅、多商户配送业务流程 |
| **6amMart docs** | https://docs.6amtech.com/ | 配送业务完整文档 |
| **litemall** | https://github.com/linlinjava/litemall | 4 端架构、小程序购物流程、数据库表设计 |
| **litemall-admin** | `litemall-admin/src/` | Vue admin 页面参考（业务逻辑通用） |

---

## 12. 禁止事项

1. **禁止内联样式**：所有样式用 Tailwind class，不再写 `style={{}}`
2. **禁止裸 HTML 标签做 UI**：用 shadcn/ui 组件（`<Button>` 不用 `<button>`，`<Card>` 不用 `<div>`）
3. **禁止页面直接调 apiFetch**：必须通过 `hooks/api/` 下的 React Query hooks
4. **禁止硬编码文案**：所有 UI 文字用 `t('key')` 国际化
5. **禁止硬编码状态颜色**：用 `StatusBadge` 组件统一管理
6. **禁止在页面组件里写数据转换逻辑**：转换函数放 hooks 或 lib/utils
7. **禁止复制参考项目的代码**：只参考模式和设计，代码要适配 MeiMart 的技术栈（Next.js 14 + shadcn/ui + next-intl）
8. **禁止用 `useEffect` + `useState` 管理服务端数据**：用 React Query 的 `useQuery` / `useMutation`
