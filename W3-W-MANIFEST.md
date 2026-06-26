# W3-W 流程完成报告 manifest

**流程代号**：W
**起止时间**：2026-06-25 ~ 2026-06-25
**完成度**：W3 ✅（catalog 客户端浏览页 admin-web 收尾 + M1 warehouse 模块收尾）
**分支**：`w3-flow-w`（10 个 commit，已 push origin）
**base**：`26aba9d`（W2 dev-fix-3，2026-06-24 main HEAD）

---

## 0. 摘要

W3-W 流程完成 CLAUDE.md §W3 启动指令指定的两项任务：

1. **catalog 客户端浏览页 admin-web 收尾**：4 个新页面（列表 / 新建 / 详情编辑 / 分类管理）+ 1 个 legacy 跳转 banner
2. **M1 warehouse 模块收尾**：3 个新页面（列表 / 新建 / 详情编辑含 coverage + inventory）+ 1 个 legacy 跳转 banner

为支撑上述任务，前置做了 5 个基础设施 commit（Phase 1）：
- 装 tailwind + shadcn/ui（14 个 P0 组件）+ @tanstack/react-query
- layout 重构（root 精简 → (legacy) 保留旧 header / (dashboard) 新 Sidebar+Header）
- DataTable + 通用展示组件 7 个
- React Query hooks 层（4 个 hook 文件，覆盖 products/categories/warehouses/inventory）

**实测**：mock-login + API curl 全通；admin-web dev server 跑 W3-W 版本，3 个新路由 200 OK + Tailwind class 生效；2 个 bug 在实测中发现并修复（后端 route ordering + 契约 mainImage/unit/iconUrl 必填）。

---

## 1. 新增独占文件（git merge 直接过，无冲突）

### admin-web 配置 + 类型（4 个）
- `apps/admin-web/postcss.config.mjs`
- `apps/admin-web/tailwind.config.ts`
- `apps/admin-web/src/app/globals.css`
- `apps/admin-web/src/lib/utils.ts`（cn helper）
- `apps/admin-web/src/types/css.d.ts`（CSS side-effect import 类型声明）

### admin-web shadcn/ui 基础组件（14 个，`components/ui/`）
- `button.tsx`（cva 6 variant × 4 size + asChild Slot）
- `input.tsx` / `textarea.tsx`
- `table.tsx`（Table/TableHeader/TableBody/TableRow/TableHead/TableCell/TableFooter/TableCaption 8 个子组件）
- `card.tsx`（Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter）
- `badge.tsx`（cva 7 variant：default/secondary/destructive/outline/success/warning/info）
- `dropdown-menu.tsx`（Radix 包 14 个子组件）
- `dialog.tsx`（Radix 包 10 个子组件）
- `separator.tsx` / `skeleton.tsx`
- `tabs.tsx`（Radix Tabs）
- `label.tsx`（Radix Label）
- `select.tsx`（Radix Select 10 个子组件）
- `checkbox.tsx`（Radix Checkbox）
- `switch.tsx`（Radix Switch）

### admin-web 布局组件（3 个，`components/layout/`）
- `sidebar.tsx`（按 perspective 过滤菜单 + lucide-react 图标 + 高亮当前路由）
- `header.tsx`（Logo + Bell 占位 + PerspectiveSwitcher + LanguageSwitcher）
- `page-header.tsx`（title + description + breadcrumb + action 槽位）

### admin-web 数据展示组件（7 个）
- `components/data-table/data-table.tsx`（泛型 T + columns render + 骨架 + 错误/空状态）
- `components/data-table/data-table-toolbar.tsx`（搜索框 + 自定义筛选槽）
- `components/data-table/data-table-pagination.tsx`（prev/next + 总页/总数）
- `components/common/status-badge.tsx`（21 个状态 → variant 映射）
- `components/common/empty-state.tsx`
- `components/common/error-state.tsx`
- `components/common/loading-skeleton.tsx`

### admin-web Provider（1 个）
- `components/providers/query-provider.tsx`（QueryClient + QueryClientProvider，staleTime 30s）

### admin-web hooks 层（4 个，`hooks/api/`）
- `use-products.ts`（useProducts / useProduct / useCreateProduct / useUpdateProduct / useUpdateProductStatus / useProductSkus / useCreateSku + I18nText/Product/Sku 类型）
- `use-categories.ts`（useCategories / useCreateCategory / useUpdateCategory / useDeleteCategory + Category 类型 + re-export I18nText）
- `use-warehouses.ts`（useWarehouses / useWarehouse / useCreateWarehouse / useUpdateWarehouse / useUpdateWarehouseCoverage / useDeleteWarehouse + Warehouse / GeoJsonPolygon 类型）
- `use-inventory.ts`（useStocks / useStockLogs / useAdjustStock + Stock/StockLog 类型）

### admin-web 业务页面（8 个新文件 + 1 个 layout）
- `app/(dashboard)/layout.tsx`（Sidebar + Header + main 三栏）
- `app/(dashboard)/page.tsx`（仪表盘首页，4 卡片 + 蓝色提示）
- `app/(dashboard)/products/page.tsx`（列表 + 搜索 + 上下架 + 行点击）
- `app/(dashboard)/products/create/page.tsx`（4 语言 name + mainImage + description + unit + category + status）
- `app/(dashboard)/products/[id]/page.tsx`（Tabs：基本信息/SKU；含 SKU 新建 Dialog）
- `app/(dashboard)/categories/page.tsx`（DataTable + 新建表单 + 编辑 Dialog + 删除 confirm）
- `app/(dashboard)/warehouses/page.tsx`（列表 + 启停状态 + 行点击）
- `app/(dashboard)/warehouses/create/page.tsx`（code select W01-W10 + 4 语言 name + lat/lng + deliveryFee + isActive）
- `app/(dashboard)/warehouses/[id]/page.tsx`（4 Tab：Basic/Coverage/Inventory/Logs）

### admin-web (legacy) 路由组（1 个 layout + 2 个 banner 修改）
- `app/(legacy)/layout.tsx`（保留 W2-W 旧 header + nav 样式 + 加 "新 UI →" 链接）
- 8 个 page.tsx git mv 自 `app/(group)/...` → `app/(legacy)/(group)/...`（URL 不变）

### 文档（1 个，跟踪 UI 标准）
- `docs/ADMIN-WEB-UI-REFERENCE.md`（用户准备，本次执行的依据）

---

## 2. 共享文件改动（主 AI 手工合并）

### `apps/admin-web/package.json`
新增 dependencies：
```json
+ "@radix-ui/react-checkbox / dialog / dropdown-menu / label / popover / select / separator / slot / switch / tabs / toast"
+ "@tanstack/react-query"
+ "class-variance-authority" / "clsx" / "tailwind-merge"
+ "lucide-react"
+ "tailwindcss" / "postcss" / "autoprefixer"
```
新增 devDependencies：
```json
+ "tailwindcss-animate"
```

### `apps/admin-web/src/app/layout.tsx`
**重构**：移除现有 header + nav inline style；精简为 NextIntlClientProvider + QueryProvider + globals.css import。

### `apps/admin-web/src/app/(legacy)/layout.tsx`（新建）
保留 W2-W 旧 header + nav 样式，加 "新 UI →" 链接引导到 /products /warehouses。

### `packages/shared-locales/{en,zh,id,pt,tet}/common.json`
新增 w.* namespace keys（按 §3.6 共用 namespace 加 w 前缀，与 W2-W 已落地的 w.perspective.* 一致）：
- `w.dashboard.title`
- `w.products.title` / `w.products.create`
- `w.categories.title`
- `w.warehouses.title` / `w.warehouses.create`

### `pnpm-lock.yaml`
admin-web 新增 99 个依赖条目（tailwind + radix + react-query + cva + clsx + tailwind-merge + lucide-react）。

### `apps/api/prisma/schema.prisma`、`apps/api/src/app.module.ts`、migration、errors.json、seed.ts
**全部未改**（W3-W 流程只动 admin-web 前端，未碰后端）。

---

## 3. 命名规范遵守自检

- [x] model 名无流程前缀（PascalCase 业务名）— 未加新 model
- [x] migration `--name` 末尾带 `_w` — 未新建 migration（admin-web 不需要）
- [x] schema export 用 xxxSchema 命名 — 未加新 zod schema
- [x] 错误码在 §3.4 W 流程的范围内 — 未加新错误码
- [x] i18n 共用 namespace 按 `{flow}.{feature}.{key}` 命名 — `w.dashboard.*` / `w.products.*` / `w.categories.*` / `w.warehouses.*` 全部加 `w.` 前缀

---

## 4. 已知冲突点 & W1/W2 完成文件改动报备（主 AI 必读）

### ⚠️ 4.1 admin-web layout.tsx 重构（关键架构改动）
W2-COLLABORATION.md §2.1 把 admin-web (shop)/(warehouse) 标记为"M 流程 territory"，但 CLAUDE.md §W3 启动指令明确把"catalog 客户端浏览页 admin-web 收尾"列为 W3-W 任务。

**冲突解决**：
- root `app/layout.tsx` 重构为最小 Provider（NextIntlClientProvider + QueryProvider + globals.css），不写 header/nav
- 新建 `app/(legacy)/layout.tsx` 保留 W2-W 旧 header + nav 样式，5 视角占位页 + 2 旧 list 页（(catalog)(merchant)(platform)(rider-mgmt)(shop)(support)(warehouse)）git mv 到 (legacy) 下，URL 完全不变
- 新建 `app/(dashboard)/layout.tsx` 用新 Sidebar + Header，W3-W 的 8 个新页面都放此路由组下

**主 AI 整合时注意**：如果 M 流程在 W3 期间也改 admin-web header 或 (shop)/(warehouse) 等 route group，需要按文件归属仲裁。本次 W 流程 git mv 了 8 个 page 文件位置（URL 不变，但文件路径变），主 AI merge 时若 M 流程也改这些文件需协调。

### ⚠️ 4.2 docs/ADMIN-WEB-UI-REFERENCE.md（用户文档）
用户 2026-06-24 准备的 UI 标准文档，本次 commit 时纳入版本控制（之前是 untracked）。文档本身约 1000 行，是后续 UI 改造（P1/P2 组件、地图绘制、订单页等）的依据。

### 4.3 共用 common.json 加 w.* namespace（不冲突）
W 流程加的 key（按 §3.6 `w.*` 前缀）：
- `w.dashboard.title`（5 语言）
- `w.products.title` / `w.products.create`（5 语言）
- `w.categories.title`（5 语言）
- `w.warehouses.title` / `w.warehouses.create`（5 语言）

未触碰 w.perspective.*（W2-W 已落地）。

### 4.4 schema.prisma / migration / errors.json / seed.ts
未改。W3-W 流程只动 admin-web 前端。

### 4.5 后端 route ordering bug（已 workaround，待主 AI / 后端修复）
**`/admin/products/categories` 被 `:id` 参数路由拦截**：AdminProductController 同时有 `@Get(':id')` 和 `@Get('categories')`，NestJS 优先匹配 :id，导致 GET /admin/products/categories 返回 E-CATALOG-001。

**Workaround**（W 流程已实施）：use-categories hook 改走 `AdminCatalogController` 的 `/admin/categories`（无 :id 冲突）。

**后端修复建议**（推下一阶段）：将 `@Get('categories')` 在 AdminProductController 里调整到 `@Get(':id')` 之前；或废弃 AdminProductController 上的 @Get('categories')，统一用 AdminCatalogController。

### 4.6 后端契约 mainImage/unit/iconUrl 必填
**契约**：CreateProductRequest.mainImage + .unit 必填；CreateCategoryRequest.iconUrl 必填。
**W 流程 hook 已对齐**：CreateProductInput.mainImage + .unit 改 required；CreateCategoryInput.iconUrl 改 required；UI 表单加 required attribute + Label 加 *。
**主 AI 注意**：W2-W manifest 当时把这些字段标 optional，本次修正。如果其他流程的前端（MeiMart1.0 客户端）依赖这些 schema，需要同步对齐。

---

## 5. 自检结果

### 5.1 代码质量
- [x] `pnpm -r typecheck` 全过（7 个 workspace：api-contract / shared-locales / shared-utils / shared-types / ui-kit / admin-web / api）
- [x] `pnpm -r test` 全过：
  - shared-utils: 6 spec / 74 tests
  - apps/api: 18 spec / 220 tests（W3-W 未改后端，原有测试不变）
- [x] `pnpm --filter @meimart/api-contract gen:openapi` 后 `git diff --exit-code` 无变更（60 paths / 66 schemas）
- [x] `pnpm --filter @meimart/shared-types gen:types` 后 `git diff --exit-code` 无变更

### 5.2 文件归属
- [x] 没改其他流程独占文件（C: order/cart/payment/dispatch/rider；M: platform/settle/im/audit）
- [x] 没改 W1/W2 完成文件（auth/health/me/shared/infrastructure）
- [x] 共享文件改动全部记录在 §2

### 5.3 浏览器实测（CLAUDE.md §W3 启动指令第 1 周内必做）
**实测环境**：
- docker compose：meimart-pg / meimart-redis / meimart-minio / meimart-mailhog 全 healthy
- 后端 API：port 3000，health check ok
- admin-web dev：port 3001，跑 W3-W 版本（verified by /products 页面有 bg-blue- / New Product / flex / rounded Tailwind class）

**实测命令**：mock-login → curl 各 endpoint → 验证响应

**实测结果**：

| 测试项 | 结果 | 备注 |
|---|---|---|
| mock-login | ✅ | accessToken 拿到 |
| GET /admin/products | ✅ | 10 条 seed 数据 |
| GET /admin/categories | ✅ | 3 条（Drinks/Food/Household） |
| GET /admin/warehouses | ✅ | 3 条（W01 Dili / W02 Baucau / W03 Maliana） |
| GET /admin/inventory/stocks | ✅ | 60 条（按 warehouseId 过滤单仓 20 条） |
| POST /admin/products（带 mainImage+unit） | ✅ | 创建成功 → status toggle → delete cleanup |
| POST /admin/categories（带 iconUrl） | ✅ | 创建成功 → delete cleanup |
| PATCH /admin/warehouses/:id/coverage | ✅ | GeoJSON Polygon 写入成功 |
| /products /warehouses /categories 新路由 | ✅ | HTTP 200 + Tailwind class 生效 |

**实测发现的 bug**（已在 [W3-W-smoke-1] 和 [W3-W-smoke-2] commit 修复）：
1. `/admin/products/categories` route ordering 被 `:id` 拦截 → use-categories 改走 `/admin/categories`
2. CreateProductInput / CreateCategoryInput 的 mainImage/unit/iconUrl 应 required（与后端契约对齐）

**实测局限**：未跑真实浏览器交互（无 Playwright/puppeteer），仅 curl + HTTP 200 + 关键 class 验证。建议主 AI 整合后跑一次端到端 Playwright 冒烟测试。

---

## 6. 遗留问题（推到下一阶段）

### 6.1 5 视角占位页未迁移到 (dashboard)
- (legacy)/(platform)/(merchant)/(rider-mgmt)/(shop)/(support) 仍是 W2 阶段的占位页（"Hello from X"）
- 待 M 流程 / 其他流程做实际内容时迁移到 (dashboard) 路由组
- 当前 (dashboard) 只有 W 流程的 4 个 W 模块页面（products/warehouses/categories/dashboard）+ 1 个仪表盘首页

### 6.2 shadcn/ui P1/P2 组件未装（按 docs/ADMIN-WEB-UI-REFERENCE.md §2.4）
P0 14 个已装；P1（form/toast/popover/tooltip/calendar 等）+ P2（command 等增强）推到 W4 或独立 PR。
本次新页面用 P0 完整覆盖了 catalog + warehouse 的 CRUD 需求。

### 6.3 仓库配送范围地图绘制 UI 推 W4
当前 coverage Area 编辑用 textarea（粘 GeoJSON），符合 MVP。地图多边形绘制 UI（Google Maps Polygon Drawing Library）需在 W4 接入，与客户端浏览页（MeiMart1.0）一并对齐。

### 6.4 admin-web 未做端到端测试（Playwright）
- 浏览器实测仅做了 curl + 渲染验证
- W6 阶段配 testcontainers + PostGIS 时一并补 Playwright 端到端

### 6.5 后端 route ordering bug（§4.5）需后端修复
本次前端 workaround，但后端 controller 顺序问题仍在。推主 AI 或下一阶段修复。

### 6.6 admin-web dev server 端口冲突（开发环境问题）
API 和 admin-web 都默认 port 3000，`turbo dev` 并行起会撞。本次实测用 admin-web 单独跑 port 3001。
建议主 AI 在 `apps/admin-web/package.json` 的 dev 脚本固化 `-p 3001`，或 `turbo.json` 加端口分配。

### 6.7 orders / customers / riders / promotions / statistics 菜单未实现
按 §2 文件分工矩阵，这些归其他流程：
- orders → C 流程
- customers → C 流程（user 是 W 流程，但客户列表管理通常在 OMS）
- riders / dispatch → C 流程
- promotions → M 流程
- statistics → M 流程
本次 Sidebar 只放 W 流程相关菜单（Dashboard / Products / Categories / Warehouses），其他视角菜单待对应流程加。

---

## 7. Commit 清单（10 个，按时间序）

```
73eb5db [W3-W-smoke-2] hook 类型对齐后端契约（mainImage/unit/iconUrl 必填）
65770e2 [W3-W-smoke-1] use-categories 改走 /admin/categories 绕开 route ordering bug
ed7caf4 [W3-W-i18n] common.json 加 w.dashboard/products/categories/warehouses namespace
bf6869e [W3-W-warehouse-1] warehouse M1 收尾（3 个新页面 + legacy banner）
ff85dd9 [W3-W-catalog-1] catalog 客户端浏览页收尾（4 个新页面 + legacy banner）
8b880ea [W3-W-infra-5] React Query hooks 层 + dashboard 首页
71945e6 [W3-W-infra-4] DataTable + 通用展示组件 7 个
88ba036 [W3-W-infra-3] layout 重构 + (dashboard) 路由组 + 布局组件
3f2e02f [W3-W-infra-2] shadcn/ui P0 基础组件 14 个
f317e71 [W3-W-infra-1] 装 tailwind + shadcn/ui 依赖 + 配置文件
```

全部 push 到 `origin/w3-flow-w`（含 force push 覆盖了 origin/w3-flow-w 之前残留的 W2-W 老 commits）。

---

**Manifest 版本**：v1.0
**生成时间**：2026-06-25
**生成者**：W3-W 流程 AI（GLM-5.2[1M]）
**分支**：`w3-flow-w` (HEAD `73eb5db`)
