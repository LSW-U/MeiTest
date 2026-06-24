# 流程 W 完成报告 manifest

**流程代号**：W
**起止时间**：2026-06-23 ~ 2026-06-24
**完成度**：W2 ✅ / W3 ✅ / W4 🟡（admin-web 最小集，客户端浏览页面归 MeiMart1.0 repo 不在本 repo）

---

## 1. 新增独占文件（git merge 直接过，无冲突）

### 后端 modules（6 个）
- `apps/api/src/modules/auth/auth.controller.ts`（**扩 W1**，新建 controller 文件，详见 §4 报备）
- `apps/api/src/modules/user/**`（user.service / user.controller / user.module）
- `apps/api/src/modules/shop/**`（shop.service / shop.controller / shop.module）
- `apps/api/src/modules/warehouse/**`（warehouse.service / warehouse.controller / warehouse.module）
- `apps/api/src/modules/catalog/**`（catalog.service / catalog.controller / catalog.module）
- `apps/api/src/modules/inventory/**`（inventory.service / inventory.controller / inventory.module）
- `apps/api/src/modules/pricing/**`（pricing.service / pricing.controller / pricing.module）

### 后端测试
- `apps/api/tests/auth.service.test.ts`（扩 W1，加 15 场景）
- `apps/api/tests/user.service.test.ts`（14 场景）
- `apps/api/tests/shop.service.test.ts`（5 场景）
- `apps/api/tests/warehouse.service.test.ts`（10 场景）
- `apps/api/tests/catalog.service.test.ts`（14 场景）
- `apps/api/tests/inventory.service.test.ts`（8 场景）
- `apps/api/tests/pricing.service.test.ts`（7 场景）

### admin-web 前端
- `apps/admin-web/src/lib/api.ts`（fetch wrapper）
- `apps/admin-web/src/lib/perspective.tsx`（视角切换 Provider）
- `apps/admin-web/src/components/PerspectiveSwitcher.tsx`
- `apps/admin-web/src/app/shop/page.tsx`（商家视角：店铺编辑）
- `apps/admin-web/src/app/warehouse/page.tsx`（仓库视角：仓库列表）
- `apps/admin-web/src/app/catalog/products/page.tsx`（商品视角：商品列表+上下架）

### 契约 schemas
- `packages/api-contract/src/schemas/auth.ts`（扩：加 4 个新 schema）
- `packages/api-contract/src/schemas/user.ts`（扩：加 Address/Favorite/Notification schemas）
- `packages/api-contract/src/schemas/catalog.ts`（**新建**，覆盖 Product/Sku/Category/Banner）
- `packages/api-contract/src/schemas/common.ts`（扩：错误码正则加 INVENTORY|PRICING|SHOP）

### i18n locales（5 语言）
- `packages/shared-locales/*/auth.json`（未扩，已有基础）
- `packages/shared-locales/*/errors.json`（扩：加 E-AUTH-011~015、E-WAREHOUSE-001~002）
- `packages/shared-locales/*/common.json`（扩：加 perspective.* 视角切换 key）

---

## 2. 共享文件改动（主 AI 手工合并）

### `apps/api/src/app.module.ts`
新增 import：
```ts
+ import { UserModule } from './modules/user/user.module';
+ import { ShopModule } from './modules/shop/shop.module';
+ import { WarehouseModule } from './modules/warehouse/warehouse.module';
+ import { CatalogModule } from './modules/catalog/catalog.module';
+ import { InventoryModule } from './modules/inventory/inventory.module';
+ import { PricingModule } from './modules/pricing/pricing.module';
```
imports 数组新增：
```ts
imports: [
  AuthModule, RealtimeModule,
+ UserModule, ShopModule, WarehouseModule, CatalogModule, InventoryModule, PricingModule,
],
```

### `apps/api/prisma/schema.prisma`
**无改动**（W1 已铺好 29 张表，W 流程复用现成 schema）。

⚠️ 后续 M 流程 platform 模块可能需要扩 Warehouse 加 `per_km_fee` / `min_order_amount` 字段（pricing 模块当前用默认值 0，扩展时建独立 migration）。

### `apps/api/prisma/migrations/`
**无新增 migration**（W 流程未改 schema）。

### `packages/api-contract/src/index.ts`
新增 export：
```ts
+ export * from './schemas/catalog';
```

### `packages/api-contract/scripts/gen-openapi.ts`
新增 schema import + register（约 30 个）：
- `LoginPasswordRequest / LoginSmsRequest / SendSmsCodeRequest / PasswordResetRequest`
- `Address / CreateAddressRequest / UpdateAddressRequest / FavoriteToggleRequest / FavoriteToggleResponse / NotificationItem / MarkNotificationReadResponse`
- `Product / ProductSummary / CreateProductRequest / UpdateProductRequest / UpdateProductStatusRequest / Sku / CreateSkuRequest / UpdateSkuRequest / Category / CreateCategoryRequest / UpdateCategoryRequest / Banner / CreateBannerRequest / UpdateBannerRequest`
- 新增 paths（约 25 个）+ tags 6 个（auth/user/address/favorite/notification/shop/warehouse/product/sku/category/banner/inventory/pricing/order）

### `packages/shared-locales/index.ts`
**无改动**（common.json 扩 key 走 namespace，未加新 namespace 文件）。

### `apps/api/prisma/seed.ts`
新增段（按 §3.5 分段注释）：
```ts
+ // ===== 7. W 流程扩展（2026-06-24）：地址 / 收藏 / 通知 / 分类 / Banner =====
+ // 2 addresses + 3 favorites + 2 notifications + 3 categories + 2 banners
```

### `packages/shared-locales/{en,zh,id,pt,tet}/errors.json`
新增错误码（按 §3.4 W 流程范围）：
- `E-AUTH-011 ~ E-AUTH-015`（5 语言翻译）
- `E-WAREHOUSE-001 / E-WAREHOUSE-002`

---

## 3. 命名规范遵守自检

- [x] model 名无流程前缀（PascalCase 业务名）— W 流程未加新 model，复用 W1 schema
- [x] migration `--name` 末尾带 `_w` — W 流程未新建 migration
- [x] schema export 用 xxxSchema 命名（变量用 `XxxRequest` / `XxxResponseData`） — 全部遵守
- [x] 错误码在 §3.4 W 流程的范围内 — E-AUTH-011~015（W1 段扩展，§4 报备）、E-WAREHOUSE-001~002（W 流程段）
- [x] i18n 共用 namespace 按 `{flow}.{feature}.{key}` 命名 — `perspective.*` 在 common namespace（共用，已 manifest §4 报备）

---

## 4. 已知冲突点 & W1 文件改动报备（主 AI 必读）

### ⚠️ 4.1 扩 W1 完成的 auth 模块
W2-COLLABORATION.md §2.4 规定 `apps/api/src/modules/auth/**` 是 W1 完成文件，扩展需报备：

**改动内容**：
- `apps/api/src/modules/auth/auth.controller.ts`（**新建**，不影响 W1 的 mock-login.controller.ts）
- `apps/api/src/modules/auth/auth.service.ts`（**扩**，加 5 个业务方法 + 1 个 helper）：
  - `inferDeviceTypeFromRole(role)` — 按 role 推断 deviceType
  - `toContractRole(prismaRole)` — Prisma 大写 enum 转 contract 小写 union
  - `loginWithPassword(phone, password)`
  - `loginWithSms(phone, smsCode)` — 不存在自动注册 customer
  - `registerUser(input)`
  - `sendSmsCode(phone, scene)`
  - `resetPassword(input)`
- `apps/api/src/modules/auth/auth.module.ts`（**扩**，controllers 数组加 AuthController，prod 也注册）
- `apps/api/tests/auth.service.test.ts`（扩，加 15 场景，vi.resetAllMocks + vi.hoisted）

**理由**：W1 的 mock-login 是 dev 工具，正式生产 endpoint 缺失。W 流程 D1-T1 必须补完整 auth 链路（密码+SMS 登录注册），否则前端 MeiMart1.0 无法登录。

**安全**：mock-login.controller.ts 未动，prod 仍按 NODE_ENV 条件不注册。

### ⚠️ 4.2 breaking change（前端 MeiMart1.0 必须适配）
按 W2-COLLABORATION.md §3.7，以下改动属于 breaking，前端 MeiMart1.0 跑 `sync-api.sh` 后必须改类型/路径：

1. **路径前缀策略**：所有客户端接口在 `/api/v1/client/*`，后台在 `/api/v1/admin/*`，公共在 `/api/v1/common/*`。前端 MeiMart1.0 之前推断的 `/api/v1/auth/*` `/api/v1/user/*` 等无 device 前缀路径**全部不正确**。
2. **Category.name 类型**：后端是 i18n JSON（`Record<string, string>`），前端 MeiMart1.0 当前是 `string`。需改类型。
3. **Address.region 结构**：后端是 `{ province, city, district? }` JSON，前端 MeiMart1.0 是 `province/city/district` 三个独立字段。需改类型。
4. **Auth 接口路径**：登录是 `/api/v1/common/auth/login-password`（kebab-case），不是 `/api/v1/auth/login/password`。
5. **deviceType 服务端推断**：前端登录请求体**不传** deviceType（服务端按 user.role 推断）。

### 4.3 共用 common.json 加了哪些 key（需 union 合并）
W 流程加的 key（M 流程加自己的不要冲突）：
- `perspective.{title, platform, merchant, warehouse, support, rider-mgmt}`（5 语言都加了）

### 4.4 schema.prisma enum
W 流程未加新 enum，未与其他流程 enum 撞名。

### 4.5 migration 时间戳
W 流程未建 migration。

---

## 5. 自检结果

- [x] `pnpm -r typecheck` 全过（除 apps/api 的 TS 6.0.3 tsconfig deprecation，W1 已知遗留，不影响实际代码）
- [x] `pnpm -r test` 全过（apps/api 122 passed）
- [x] `pnpm --filter @meimart/api-contract gen:openapi` 后 git diff --exit-code 无变更
- [x] `pnpm --filter @meimart/shared-types gen:types` 后 git diff --exit-code 无变更

**OpenAPI 当前状态**：44 paths，51 schemas。

---

## 6. 遗留问题（推到下一阶段）

### 6.1 PostGIS 集成测试（W6 补）
- `findWarehouseByPoint` / `setWarehouseGeometry` 单测目前用 vi.mock 跳过 raw SQL，**未覆盖真实 PostGIS 行为**。
- W6 用 testcontainers 起 `postgis/postgis:16-3.4` 真实容器，补：
  - warehouse.service 的 coverage GeoJSON 读写
  - inventory.service 的 matchWarehouse 实际 ST_Within 查询
  - 防超卖并发测试（多事务同时 deductStock）

### 6.2 pricing 简化（M 流程扩展）
- 当前 perKmFee / minOrderAmount 用默认值 0（MVP 简化）
- M 流程 platform 模块做配置管理时，建议加 `system_config` 表存这两个参数，pricing.service 从 config 读
- 同时考虑扩 Warehouse schema 加 `per_km_fee` / `min_order_amount` 字段（独立 migration，命名 `_m` 或 `_platform` 后缀）

### 6.3 admin-web 未做浏览器实测
- 3 个页面已写完，但未在真实 backend + admin token 环境下浏览器验证
- 主 AI 整合后跑 `docker compose up + pnpm dev + mock-login` 实测：
  1. POST /api/v1/common/auth/mock-login { role: super_admin, deviceType: admin_web } 拿 token
  2. localStorage.setItem('admin_token', '<token>')
  3. 访问 http://localhost:3001/shop / /warehouse / /catalog/products 看数据是否渲染

### 6.4 Coupon 接口未实现
- 前端 MeiMart1.0 调 `/user/coupons`，但 schema 里没有 Coupon model
- 推到 M 流程 platform 模块（促销管理）

### 6.5 客户端浏览页面归 MeiMart1.0
- W-M-C-T 任务清单 W4 提到的"客户端商品浏览页面"全部归 MeiMart1.0 repo（MeiMart）
- 本 repo 不做 client-app/rider-app 代码（决策见 W2-COLLABORATION.md §2.5）

---

**Manifest 版本**：v1.1（v1.0 + 审查 fix P0/P1）
**生成时间**：2026-06-24
**生成者**：流程 W AI（GLM-5.2）

---

## 7. 审查 fix 记录（v1.0 → v1.1）

主 AI 审查后要求修复 P0+P1 共 5 项，全部已修，每项独立 commit：

### P0-1: i18n key 加 w 前缀（§3.6）
- commit: `[W2-W-fix-P0-1] perspective i18n key 加 w 前缀`
- 改动：5 语言 common.json `perspective.*` → `w.perspective.*`（嵌套 JSON）；PerspectiveSwitcher.tsx 引用同步

### P0-2: E-AUTH-011~015 迁到 E-USER-001~005（§3.4）
- commit: `[W2-W-fix-P0-2] E-AUTH-011~015 迁到 E-USER-001~005`
- 改动：5 语言 errors.json 删 AUTH-011~015 段，加 USER-001~005 段；auth.service.ts（11 处）+ auth.controller.ts（1 处）+ auth.service.test.ts（8 处）全替换

### P1-3: admin-web 路由组加括号（§2.1）
- commit: `[W2-W-fix-P1-3] admin-web 3 路由组加括号`
- 改动：`app/shop` → `app/(shop)`，`app/warehouse` → `app/(warehouse)`，`app/catalog` → `app/(catalog)`（git mv 保留 history，URL 不变）

### P1-4: seed.ts 注释标准化（§3.5）
- commit: `[W2-W-fix-P1-4] seed.ts 分段注释改 // === FLOW W === 标准格式`
- 改动：`// ===== 7. W 流程扩展 =====` → `// === FLOW W === W 流程扩展（2026-06-24）`

### P1-5: 4 模块加专属错误码（§3.4）
- commit: `[W2-W-fix-P1-5] 4 模块加专属错误码`
- 改动：6 个新错误码（E-SHOP-001 / E-CATALOG-001 / E-INVENTORY-001 / E-INVENTORY-002 / E-PRICING-001）+ 5 语言翻译 + 代码引用全替换

### 最终验证
- `pnpm -r typecheck`：apps/admin-web ✅ / apps/api 仅 TS 6.0.3 已知 deprecation（W1 遗留，不影响代码）
- `pnpm -r test`：122 passed ✅
- `pnpm --filter @meimart/api-contract gen:openapi`：44 paths, 51 schemas ✅
- `pnpm --filter @meimart/shared-types gen:types`：成功 ✅
- gen 后 `git diff --exit-code`：无变更 ✅

### 错误码段最终状态（按 §3.4 分段，整合后给主 AI 参考）

W 流程使用的错误码段（不在 W1 共享段）：
- `E-USER-001~005`（W 流程：用户认证相关）
- `E-SHOP-001`（W 流程：店铺）
- `E-WAREHOUSE-001~002`（W 流程：仓库）
- `E-CATALOG-001`（W 流程：商品目录）
- `E-INVENTORY-001~002`（W 流程：库存）
- `E-PRICING-001`（W 流程：配送费 + 起送价）

W 流程**未触碰**的错误码段（其他流程独占）：
- `E-AUTH-*`（W1 共享段，已迁出 W 流程的 5 个码）
- `E-COMMON-*`（W1 共享段，pricing 保留 1 处 fallback）
- `E-ORDER-*` `E-PAYMENT-*` `E-DISPATCH-*` `E-RIDER-*`（C 流程段）
- `E-PLATFORM-*` `E-SETTLE-*` `E-IM-*` `E-AUDIT-*`（M 流程段）

---
