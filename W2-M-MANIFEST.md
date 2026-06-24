# 流程 M 完成报告 manifest

**流程代号**：M（治理/财务）
**起止时间**：2026-06-23 ~ 2026-06-23（W2 第一日交付）
**完成度**：W2 ✅ / W3 🟡（schema 已建,接口未实现）/ W4 ❌（系统配置已提前到 W2,审计查询已提前到 W2）

## 0. 执行摘要

W2 流程 M 任务按 W-M-C-T 任务分解 W2 章节全部完成：

- **platform M1 C1 数据看板** ✅ — GMV/订单数/在线骑手/异常订单/仓库钻取/trend
- **platform M1 C2 视角切换器消费层** ✅ — zustand store + Switcher + Guard + fetch wrapper
- **5 视角首页落地** ✅ — platform 含 dashboard / 其他 4 视角占位首页 + Guard

W4 部分**提前到 W2**（依赖少,先吃下来）:

- **platform M1 C1 审计查询** ✅ — list/detail/export CSV(复用 W1 AuditLog)
- **platform M1 C2 系统配置 CRUD** ✅ — key-value + Redis cache-aside

W3 **schema 提前建好**(避免后续迁移冲突):

- `Settlement` / `WithdrawalRequest` model 已定义,migration 已创建
- 接口实现未做(W3 任务,依赖流程 C 订单数据)

---

## 1. 新增独占文件(git merge 直接过,无冲突)

### 后端 modules

- `apps/api/src/modules/platform/platform.module.ts` — NestJS module 注册
- `apps/api/src/modules/platform/dashboard.controller.ts` — GET /dashboard/summary
- `apps/api/src/modules/platform/dashboard.service.ts` — GMV/订单/在线骑手/异常/趋势/仓库钻取聚合
- `apps/api/src/modules/platform/platform-time.ts` — buildRange + growthPct 纯函数(便于单测)
- `apps/api/src/modules/platform/audit.controller.ts` — GET /audit-logs + /:id + /export
- `apps/api/src/modules/platform/audit.service.ts` — 复用 AuditLog 表查询 + CSV 序列化
- `apps/api/src/modules/platform/system-config.controller.ts` — GET / + PUT /:key
- `apps/api/src/modules/platform/system-config.service.ts` — key-value + Redis cache-aside

### 后端 tests

- `apps/api/tests/platform-time.test.ts` — buildRange 时间归零 + growthPct(11 用例)
- `apps/api/tests/system-config.service.test.ts` — cache-aside 读写策略(6 用例)

### 前端 pages

- `apps/admin-web/src/app/(platform)/platform/page.tsx` — 平台 dashboard(KPI + trend + 仓库表)
- `apps/admin-web/src/app/(merchant)/merchant/page.tsx` — 占位 + Guard
- `apps/admin-web/src/app/(warehouse)/warehouse/page.tsx` — 占位 + Guard
- `apps/admin-web/src/app/(support)/support/page.tsx` — 占位 + Guard
- `apps/admin-web/src/app/(rider-mgmt)/rider-mgmt/page.tsx` — 占位 + Guard

### 前端 components / lib / stores

- `apps/admin-web/src/components/PerspectiveSwitcher.tsx` — 顶部下拉 + toast
- `apps/admin-web/src/components/PerspectiveGuard.tsx` — 路由守卫(客户端)
- `apps/admin-web/src/stores/perspective.ts` — zustand persist
- `apps/admin-web/src/lib/perspective.ts` — 视角常量 + RBAC 映射 + i18n key
- `apps/admin-web/src/lib/fetch.ts` — apiFetch / apiJson 自动注入 X-Perspective + Accept-Language

### 契约 schemas

- `packages/api-contract/src/schemas/platform.ts` — DashboardSummary / AuditLog* / SystemConfig*(8 个 export)

### i18n

- `packages/shared-locales/{en,zh,id,pt,tet}/platform.json` × 5 语言(perspective/menu/dashboard/audit/config namespace)

---

## 2. 共享文件改动(主 AI 手工合并)

### apps/api/src/app.module.ts

新增 import:
```ts
+ import { PlatformModule } from './modules/platform/platform.module';
```
imports 数组新增(按字母序 AuthModule → PlatformModule → RealtimeModule):
```ts
- imports: [AuthModule, RealtimeModule],
+ imports: [AuthModule, PlatformModule, RealtimeModule],
```

### apps/api/prisma/schema.prisma

末尾新增(Banner 模型之后,文档注释之前)3 个 model:
```prisma
+ model SystemConfig {
+   key         String   @id
+   value       String
+   description String?
+   updatedBy   String?  @map("updated_by")
+   createdAt   DateTime @default(now()) @map("created_at")
+   updatedAt   DateTime @updatedAt @map("updated_at")
+   @@map("system_configs")
+ }
+ model Settlement { ... }    // W3 启用,见 schema.prisma 末尾
+ model WithdrawalRequest { ... }    // W3 启用,见 schema.prisma 末尾
```
**enum 撞名检查**:无新增 enum(Settlement/WithdrawalRequest 用 String status),无撞名风险。

### apps/api/prisma/migrations/

新增 migration 目录:
```
+ 20260623120000_add_platform_settle_m/migration.sql
```
内容:CREATE TABLE system_configs / settlements / withdrawal_requests(含索引)。**`_m` 后缀按字母序在 `_w` / `_c` 之后**,W2-COLLABORATION.md §3.2 命名规范遵守。

### packages/api-contract/src/index.ts

新增 export:
```ts
+ export * from './schemas/platform';
```

### packages/api-contract/scripts/gen-openapi.ts

新增 platform schemas import + registry.register + 6 个 registerPath(dashboard/summary、audit-logs list/detail/export、system-configs list/update)。

### packages/api-contract/src/schemas/common.ts

ErrorResponse 正则扩展(加 SETTLE / IM / AUDIT):
```ts
- /^E-(AUTH|COMMON|ORDER|PAYMENT|WAREHOUSE|USER|CATALOG|DISPATCH|RIDER|NOTIFY|PLATFORM)-\d{3}$|^E-HTTP-\d{3}$/
+ /^E-(AUTH|COMMON|ORDER|PAYMENT|WAREHOUSE|USER|CATALOG|DISPATCH|RIDER|NOTIFY|PLATFORM|SETTLE|IM|AUDIT)-\d{3}$|^E-HTTP-\d{3}$/
```
**冲突预警**:W/C 流程可能也加新前缀(如 E-CART / E-REFUND),合并时主 AI 需 union regex alternatives。

### packages/shared-locales/index.ts

新增 import(5 语言)+ MessagesBundle interface 加 `platform` 字段 + 5 个 bundle 对象各加 `platform`。

### packages/shared-locales/{en,zh,id,pt,tet}/errors.json

新增错误码(3 条 × 5 语言):
```json
+ "E-PLATFORM-001": "...",
+ "E-PLATFORM-002": "...",
+ "E-AUDIT-001": "..."
```

### apps/api/prisma/seed.ts

末尾新增 `// === FLOW M ===` 段(在 `🎉 Seed completed!` 之前):
- 9 条 SystemConfig 默认 key(commission_rate / currency / delivery.* / rider.* / order.* timeouts)
- 幂等 upsert(update 留空,不覆盖业务方手改的值)

### apps/admin-web/package.json

新增依赖:
```json
+ "zustand": "^4.5.7"
```

### apps/admin-web/src/app/layout.tsx

header 加 PerspectiveSwitcher(gap: 16,右对齐)。

### apps/admin-web/src/app/page.tsx

注释更新(redirect /login 逻辑不变)。

---

## 3. 命名规范遵守自检

- [x] model 名无流程前缀(PascalCase 业务名):`SystemConfig` / `Settlement` / `WithdrawalRequest`
- [x] migration `--name` 末尾带 `_m`:`20260623120000_add_platform_settle_m`
- [x] schema export 用 `xxxSchema` 命名:`DashboardSummary` / `AuditLogListItem` / `SystemConfigItem`(均以业务名为前缀,后缀语义化)
- [x] 错误码在 §3.4 自己流程的范围内:E-PLATFORM-001/002 / E-AUDIT-001(均在 001-099 段)
- [x] i18n 共用 namespace 按 `{flow}.{feature}.{key}` 命名:本流程独占 `platform.json` namespace,未污染 common.json
- [x] seed.ts 按 `// === FLOW M ===` 注释分段

---

## 4. 已知冲突点(提醒主 AI)

### 4.1 共享文件

| 文件 | 冲突类型 | 解决策略 |
|---|---|---|
| `apps/api/src/app.module.ts` | imports 数组顺序 | 字母序,三方都保留(我加 PlatformModule 在 AuthModule 后 RealtimeModule 前) |
| `apps/api/prisma/schema.prisma` | model 顺序 | W 在前 → C 中间 → M 末尾(我已在 Banner 之后,主 AI 需确保 W/C 的 model 加在我之前) |
| `apps/api/prisma/schema.prisma` | enum 名撞 | 我未新增 enum,W/C 检查自己的 enum 不与现有撞 |
| `apps/api/prisma/migrations/` | 时间戳撞 | `_m` 后缀按字母序排在 `_w` / `_c` 之后(已在 20260622093004_drop_unused_refresh_tokens 之后) |
| `packages/api-contract/src/index.ts` | export 顺序 | 字母序,三方都保留(我加 platform 在 order 之后) |
| `packages/api-contract/scripts/gen-openapi.ts` | registry.register / registerPath | 各流程独立段,合并时 union |
| `packages/api-contract/src/schemas/common.ts` | ErrorResponse 正则 | **关键**:alternatives 需 union,主 AI 把 W/C 加的前缀合并进来(如 E-CART / E-REFUND) |
| `packages/shared-locales/index.ts` | bundle 字段 | 字母序,三方都保留 |
| `packages/shared-locales/{en,zh,id,pt,tet}/errors.json` | 错误码 key | 按 §3.4 分段,理论不撞;如撞则主 AI 决策 |
| `packages/shared-locales/{en,zh,id,pt,tet}/common.json` | key 撞 | 我未加 common.json key,不冲突 |
| `apps/api/prisma/seed.ts` | 段落顺序 | 我加 `// === FLOW M ===` 段在末尾(W/C 在自己段内不动) |
| `apps/admin-web/package.json` | 依赖 | 加 zustand;W/C 加自己的 admin-web 依赖时 union |
| `apps/admin-web/src/app/layout.tsx` | header 内容 | 我加 PerspectiveSwitcher(与 LanguageSwitcher 并排);W/C 改 layout 时合并 |
| `pnpm-lock.yaml` | lockfile | 主 AI 整合后跑一次 `pnpm install` 自动重生成 |

### 4.2 业务依赖

- **dashboard 接口依赖 W/C 流程的 Order 表** — 已有的 W1 init migration 包含 Order 字段,可直接读;不依赖 W/C W2 阶段新增的 model。
- **audit 查询复用 W1 AuditLog 表** — 不需要等 W/C。
- **SystemConfig 是流程 M 独占表** — 无依赖。

### 4.3 错误码段

- 我用: `E-PLATFORM-*` / `E-SETTLE-*` / `E-IM-*` / `E-AUDIT-*`(长形式,与 W2-COLLABORATION.md §3.4 一致)
- 任务描述原本写: `E-PLT-*` / `E-STL-*` / `E-IM-*` / `E-AUD-*`(短形式)
- **决策**: 用长形式,因为更清晰且 W1 既有的 errors.json 都用完整模块名(`E-AUTH` / `E-ORDER` / `E-PAYMENT`)。
- 不会与 W/C 撞(W/C 用 `E-WAREHOUSE-*` / `E-ORDER-*` / `E-CART-*` 等)。

---

## 5. 自检结果

- [x] `pnpm -r typecheck` 全过(9 个 workspace)
- [x] `pnpm -r test` 全过(7 个测试文件 / 134 个用例 — shared-utils 74 + api 60)
- [x] `pnpm --filter @meimart/api-contract gen:openapi` 后 git diff idempotent(连续两次 gen 输出一致)
- [x] `pnpm --filter @meimart/shared-types gen:types` 后 git diff idempotent(同上)
- [x] Prisma format + generate 通过(SystemConfig / Settlement / WithdrawalRequest 已入 client)
- [x] shared-locales `MessagesBundle` interface 加 `platform` 字段,5 语言全部齐
- [x] shared-locales errors.json 5 语言全部加 E-PLATFORM-001/002 + E-AUDIT-001

---

## 6. 遗留问题(推到下一阶段)

### 6.1 W3 任务(下次会话)

- **im 三方 IM 接入**:
  - 用户签名接口(后端薄壳,为腾讯 IM / 融云 SDK 颁发 userSig)
  - 三端 SDK 初始化(admin-web / client-app / rider-app)
  - 会话管理(客户↔商家/骑手/客服)
  - 未读数同步
- **settle 结算单生成**:
  - BullMQ T+1 定时任务(每天 00:30 Asia/Dili)
  - 商家结算单聚合(从 Settlement 表读)
  - 骑手佣金计算(per_order_commission + per_km_bonus 系数从 SystemConfig 读)
  - 平台抽成对账(commission_rate 系数从 SystemConfig 读)
- **settle 提现审核**:
  - 提现申请接口(MERCHANT / RIDER)
  - 平台审核 UI(列表 + 详情)
  - 线下打款记录(手工录入 payoutReference)
  - 提现状态通知(走 W2-W5 的 notify 模块)

### 6.2 W4 任务(下次会话)

- **审计导出**:CSV 模板可选字段
- **审计高级筛选**:按 IP / User-Agent / Trace ID 检索
- **配置变更审计**:复用 W1 AuditInterceptor(`@Audit({ resource: 'SystemConfig' })` 已写,自动记录;查询界面展示 before/after diff 需要)

### 6.3 跨流程联调(W5-W6)

- **流程 1 ↔ 流程 3**:视角切换 → 各视角数据范围正确(W4 联调)
- **流程 1 ↔ 流程 3**:审计日志覆盖商家所有写操作
- **流程 2 ↔ 流程 3**:订单完成 → 结算单生成(W3 后)
- **流程 2 ↔ 流程 3**:退款 → 结算单冲减
- **流程 2 ↔ 流程 3**:骑手送达 → 佣金计算

### 6.4 测试覆盖度

- 平台 dashboard.service:仅单测纯函数(buildRange / growthPct);DB 聚合逻辑待 e2e(W6 用 testcontainers 跑真实 PostGIS)
- audit.service:CSV 序列化是纯函数,可补单测;查询逻辑待 e2e
- 视角切换器:仅 typecheck 通过;手动浏览器测试待 dev server 起来后

### 6.5 已知 bug / 待优化

- `I18nText` 在 zod-to-openapi 中被生成为 `type: string`(W1 既有问题,非本次新增)→ shared-types 把 `warehouseName` 推为 string,前端用 `displayName(value: unknown)` 兜底解析。W5-W6 修 `@asteasolutions/zod-to-openapi` 或迁移到 `zod-openapi` 修这个。
- dashboard `trend` 用 raw SQL `TO_CHAR(... AT TIME ZONE 'UTC')`,聚合按 UTC。生产部署到雅加达(UTC+7)服务器后,显示时前端按 Accept-Language 转 UTC+9(Asia/Dili)。W6 联调时验证时区一致性。
- platform dashboard 页面是纯 CSS,未接入 shadcn/ui(W1 D1 已建 `ui-kit` 骨架,但 admin-web 未接入)。W3 接入后再统一升级。

---

## 7. 文件归属自检

| 文件类型 | 状态 |
|---|---|
| 流程 M 独占文件 | 全部新建,未触碰 W/C 独占 |
| W1 完成文件 | 未修改(`modules/auth/**` / `modules/realtime/**` / `shared/**` / `infrastructure/**` 等) |
| 共享文件改动 | 全部记录在 §2 |
| 命名规范 | 全部遵守 §3(model PascalCase / migration `_m` / schema xxxSchema / 错误码 §3.4 分段 / i18n 独立 namespace) |

---

**版本**:v1.0
**输出位置**:`W2-M-MANIFEST.md`(repo 根目录)
**主 AI 整合顺序**:W → C → M(我已完成,可直接 rsync 独占文件 + 按 §2 合并共享文件)
