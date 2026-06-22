---
title: MeiMart W2 三流程协作规范
date: 2026-06-23
tags: [MeiMart, W2, 三流程, 协作规范, 离线并行]
---

# MeiMart W2 三流程协作规范

> **适用场景**：三个 AI 在独立环境离线并行 → 各自完成后由主 AI 整合 merge
>
> **强制前置阅读**（按顺序）：
> 1. `CLAUDE.md`（项目根指令，技术栈 + 业务决策 + 全局约束）
> 2. `MeiMart-三流程并行开发方案-20260617.md`（流程归属 + 节奏 + 联调要点）
> 3. `MeiMart-三流程W-M-C-T任务分解-20260617.md`（每流程的 W-M-C-T 细粒度任务）
> 4. `MeiMart-W1验收报告-20260621.md`（W1 完成状态 + 遗留风险）
> 5. 本规范

---

## §1. 总则

### 1.1 协作模式

- 三个 AI 各自 clone W1 完成的代码库（HEAD 见 `git log` 最后一个 `[W1-*]` commit）
- 各自按 W-M-C-T 任务分解完成自己流程的任务
- 各自完成后输出完成报告 manifest（见 §4）
- 主 AI 拿到 3 份代码 + 3 份 manifest 后按 §6 流程整合

### 1.2 三流程代号

| 代号 | 流程 | 模块 | W-M-C-T 文档章节 |
|---|---|---|---|
| **W** | 流程 1 — 供给/仓储/浏览 | auth · user · shop · warehouse · catalog · inventory · pricing | "🟦 流程 1" |
| **C** | 流程 2 — 交易/配送 | cart · order · payment · refund · dispatch · rider · location · notify | "🟩 流程 2" |
| **M** | 流程 3 — 治理/财务 | platform · settle · im · audit | "🟨 流程 3" |

> **命名后缀**：W / C / M（与流程代号一致，用于 migration 文件名、commit 前缀、PR 标题）

### 1.3 通信约束

- 三个 AI **不直接通信**（离线并行）
- 共享文件冲突由 §3 命名规范 + §4 manifest 提前规避
- 整合期发现冲突由主 AI 按 §6 流程决策

---

## §2. 文件分工矩阵

### 2.1 流程 W 独占（流程 C / M 不得改）

**后端**：
- `apps/api/src/modules/warehouse/**`
- `apps/api/src/modules/catalog/**`
- `apps/api/src/modules/inventory/**`
- `apps/api/src/modules/pricing/**`
- `apps/api/src/modules/shop/**`（W1 已有 shop model，W 流程扩展）
- `apps/api/src/modules/user/**`（资料、地址）
- `apps/api/src/modules/category/**`（如拆分）

**前端**：
- `apps/admin-web/src/app/(shop)/**`（商家视角）
- `apps/admin-web/src/app/(warehouse)/**`（仓库视角）
- `apps/client-app/src/screens/home/**`
- `apps/client-app/src/screens/shop/**`
- `apps/client-app/src/screens/category/**`

**契约**：
- `packages/api-contract/src/schemas/warehouse.ts`
- `packages/api-contract/src/schemas/catalog.ts`
- `packages/api-contract/src/schemas/inventory.ts`
- `packages/api-contract/src/schemas/pricing.ts`
- `packages/api-contract/src/schemas/shop.ts`
- `packages/api-contract/src/schemas/user.ts`

**i18n**：
- `packages/shared-locales/{en,zh,id,pt,tet}/warehouse.json`
- `packages/shared-locales/{en,zh,id,pt,tet}/catalog.json`
- `packages/shared-locales/{en,zh,id,pt,tet}/shop.json`
- `packages/shared-locales/{en,zh,id,pt,tet}/user.json`

### 2.2 流程 C 独占（流程 W / M 不得改）

**后端**：
- `apps/api/src/modules/order/**`
- `apps/api/src/modules/cart/**`
- `apps/api/src/modules/payment/**`
- `apps/api/src/modules/refund/**`
- `apps/api/src/modules/dispatch/**`
- `apps/api/src/modules/rider/**`
- `apps/api/src/modules/location/**`
- `apps/api/src/modules/notify/**`

**前端**：
- `apps/client-app/src/screens/cart/**`
- `apps/client-app/src/screens/order/**`
- `apps/client-app/src/screens/payment/**`
- `apps/rider-app/**`（骑手 App 整个归流程 C）

**契约**：
- `packages/api-contract/src/schemas/order.ts`（W1 已存在，C 扩展）
- `packages/api-contract/src/schemas/cart.ts`
- `packages/api-contract/src/schemas/payment.ts`（W1 已存在，C 扩展）
- `packages/api-contract/src/schemas/dispatch.ts`
- `packages/api-contract/src/schemas/rider.ts`

**i18n**：
- `packages/shared-locales/{en,zh,id,pt,tet}/order.json`（W1 已存在）
- `packages/shared-locales/{en,zh,id,pt,tet}/payment.json`（W1 已存在）
- `packages/shared-locales/{en,zh,id,pt,tet}/dispatch.json`（新增）
- `packages/shared-locales/{en,zh,id,pt,tet}/rider.json`（新增）

### 2.3 流程 M 独占（流程 W / C 不得改）

**后端**：
- `apps/api/src/modules/platform/**`
- `apps/api/src/modules/settle/**`
- `apps/api/src/modules/im/**`
- `apps/api/src/modules/audit/**`（审计模块归 M，复用 W1 的 AuditLog 表）

**前端**：
- `apps/admin-web/src/app/(platform)/**`（平台视角：dashboard / config / audit）
- `apps/admin-web/src/app/(settle)/**`（结算视角）
- `apps/admin-web/src/app/(im)/**`（IM 视角）

**契约**：
- `packages/api-contract/src/schemas/platform.ts`
- `packages/api-contract/src/schemas/settle.ts`
- `packages/api-contract/src/schemas/im.ts`
- `packages/api-contract/src/schemas/audit.ts`

**i18n**：
- `packages/shared-locales/{en,zh,id,pt,tet}/platform.json`（新增）
- `packages/shared-locales/{en,zh,id,pt,tet}/settle.json`（新增）
- `packages/shared-locales/{en,zh,id,pt,tet}/im.json`（新增）

### 2.4 W1 已完成、三流程都不改

- `apps/api/src/modules/auth/**`（除非扩展 OTP 策略，需在 manifest 报备）
- `apps/api/src/modules/health/**`
- `apps/api/src/modules/me/**`（W2 替换为 profile controller 时再删）
- `apps/api/src/shared/**`（基建层，需扩展时单独 PR，不在 W2 三流程内）
- `apps/api/src/infrastructure/**`（外部服务抽象，W1 已完成）
- `apps/api/prisma/migrations/20260620031102_init/**`（init migration 不动）
- `apps/api/prisma/migrations/20260622093004_drop_unused_refresh_tokens/**`

### 2.5 共享文件（三流程都改，最后手工 merge）

| 文件 | 冲突点 |
|---|---|
| `apps/api/src/app.module.ts` | 三方都加 Module import 和 imports 数组项 |
| `apps/api/prisma/schema.prisma` | 三方都在末尾加 model |
| `apps/api/prisma/migrations/` | 三方都新建 migration 目录（按 §3.2 命名防撞） |
| `packages/api-contract/src/schemas/index.ts` | 三方都加 export |
| `packages/api-contract/openapi.yaml` | 自动生成产物，merge 后跑 `gen:openapi` 重新生成 |
| `packages/shared-locales/index.ts` | 三方都加 i18n bundle 注册 |
| `packages/shared-locales/{en,zh,id,pt,tet}/common.json` | 共用 namespace，三方都可能加 key |
| `packages/shared-locales/{en,zh,id,pt,tet}/errors.json` | 错误码可能撞（按 §3.4 分段） |
| `apps/api/prisma/seed.ts` | 三方都可能扩展 seed（按 §3.5 分段） |

---

## §3. 命名规范（防撞）

### 3.1 Prisma model 命名

- **业务名词，无流程前缀**：`Order` / `Warehouse` / `Settlement`（不叫 `COrder` / `WWarehouse`）
- **PascalCase**，单数
- **关系表用单数 + 关联**：`OrderItem` / `CartItem` / `RiderProfile`
- 新增 model 一律追加到 `schema.prisma` 末尾，不动其他流程的 model

### 3.2 Migration 文件名（关键，防时间戳撞）

格式：`{timestamp}_{name}_{flow}.sql`

- timestamp：使用各自 AI 本地时间（不要统一）
- name：业务名 snake_case
- flow：`w` / `c` / `m`（流程代号）

示例：
- W 流程：`20260625100000_add_warehouse_coverage_w/migration.sql`
- C 流程：`20260625100000_add_order_status_c/migration.sql`
- M 流程：`20260625100000_add_settlement_m/migration.sql`

**生成方式**：`prisma migrate dev --create-only --name add_xxx_w`（注意 prisma 会自动加 timestamp 前缀，只需确保 `--name` 末尾带流程代号）

### 3.3 Contract schema export 命名

- **schema 变量**：`{business}Schema`（camelCase + Schema 后缀），如 `orderSchema` / `settlementSchema`
- **文件名**：业务名 kebab-case 或 camelCase（与现有 `warehouse.ts` / `order.ts` 一致）
- **OpenAPI 注册**：`registry.register('Order', orderSchema)` — 业务名 PascalCase

### 3.4 错误码分段（防 errors.json 撞）

按流程分段（W1 已用 `E-AUTH-*` / `E-COMMON-*`）：

| 流程 | 错误码前缀 | 范围 |
|---|---|---|
| 共享（W1） | `E-AUTH-*` / `E-COMMON-*` | 001-099 |
| W 流程 | `E-WAREHOUSE-*` / `E-CATALOG-*` / `E-INVENTORY-*` / `E-PRICING-*` / `E-SHOP-*` | 001-099 |
| C 流程 | `E-ORDER-*` / `E-CART-*` / `E-PAYMENT-*` / `E-DISPATCH-*` / `E-RIDER-*` | 001-099 |
| M 流程 | `E-PLATFORM-*` / `E-SETTLE-*` / `E-IM-*` / `E-AUDIT-*` | 001-099 |

各流程在自己的模块前缀内自由编号，**不得跨流程**。

### 3.5 Seed 分段

`apps/api/prisma/seed.ts` 用 `// === FLOW W ===` / `// === FLOW C ===` / `// === FLOW M ===` 注释分段，三流程各自在自己段内加 seed，不动其他段。

### 3.6 i18n key 命名

- **每流程独占 namespace**（如 `order.json` / `settle.json`），不冲突
- **共用 namespace（common.json）**：按 `{flow}.{feature}.{key}` 命名，如 `w.warehouse.open` / `c.cart.count` / `m.settle.total`
- 跨流程共用的 key（如 `common.confirm` / `common.cancel`）三方都可用，但 **manifest 必须报备**

---

## §4. 完成报告 manifest（推荐）

每个 AI 完成自己流程后，**强烈推荐输出一份 markdown manifest**，主 AI 拿到后按图 merge。无 manifest 也能 merge（主 AI 自己 git diff），但成本高、易错。

### 4.1 Manifest 模板

```markdown
# 流程 {W|C|M} 完成报告 manifest

**流程代号**：W / C / M
**起止时间**：YYYY-MM-DD ~ YYYY-MM-DD
**完成度**：W2 ✅ / W3 🟡 / W4 ❌（详情见 W-M-C-T 任务清单对应章节）

## 1. 新增独占文件（git merge 直接过，无冲突）

### 后端 modules
- apps/api/src/modules/xxx/** （新建，N 个文件）
- ...

### 前端 screens
- apps/client-app/src/screens/xxx/** （新建）
- ...

### 契约 schemas
- packages/api-contract/src/schemas/xxx.ts （新建）

### i18n
- packages/shared-locales/{en,zh,id,pt,tet}/xxx.json （新建 × 5 语言）

## 2. 共享文件改动（主 AI 手工合并）

### apps/api/src/app.module.ts
新增 import：
  + import { XxxModule } from './modules/xxx/xxx.module';
imports 数组新增：
  + XxxModule

### apps/api/prisma/schema.prisma
末尾新增 model（贴完整定义）：
  + model Xxx { ... }

### apps/api/prisma/migrations/
新增 migration 目录：
  + 20260625100000_add_xxx_{w|c|m}/migration.sql

### packages/api-contract/src/schemas/index.ts
新增 export：
  + export * from './xxx';

### packages/shared-locales/index.ts
新增 import + bundle 注册：
  + import enXxx from './en/xxx.json';
  + ...（5 语言）
  + bundle 加 xxx: enXxx 字段

### packages/shared-locales/{en,zh,id,pt,tet}/common.json
新增 key（按 §3.6 命名）：
  + "{flow}.{feature}.{key}": "..."

### packages/shared-locales/{en,zh,id,pt,tet}/errors.json
新增错误码（按 §3.4 分段）：
  + "E-XXX-001": "..."

### apps/api/prisma/seed.ts
新增段（按 §3.5 分段注释）：
  + // === FLOW {W|C|M} ===
  + ... seed 内容

## 3. 命名规范遵守自检

- [ ] model 名无流程前缀（PascalCase 业务名）
- [ ] migration `--name` 末尾带 _w / _c / _m
- [ ] schema export 用 xxxSchema 命名
- [ ] 错误码在 §3.4 自己流程的范围内
- [ ] i18n 共用 namespace 按 {flow}.{feature}.{key} 命名

## 4. 已知冲突点（提醒主 AI）

- [ ] 共用 common.json 加了哪些 key（需 union 合并）
- [ ] schema.prisma 加了哪些 enum（可能与其他流程 enum 撞名）
- [ ] migration 时间戳是否与其他流程撞（按 _w / _c / _m 字母序 merge 即可）

## 5. 自检结果

- [ ] pnpm -r typecheck 全过
- [ ] pnpm -r test 全过（新增 N 个测试）
- [ ] pnpm --filter @meimart/api-contract gen:openapi 后 git diff --exit-code 无变更
- [ ] pnpm --filter @meimart/shared-types gen:types 后 git diff --exit-code 无变更

## 6. 遗留问题（推到下一阶段）

- 任务 X 未完成，原因：...
- 风险 Y 需要主 AI 决策：...
```

### 4.2 Manifest 输出位置

每个 AI 在自己 repo 根创建 `W2-{FLOW}-MANIFEST.md`（如 `W2-C-MANIFEST.md`），主 AI clone 时直接看到。

---

## §5. PR 自检 checklist

每个 AI 在自己流程结束前必须确认：

### 5.1 代码质量
- [ ] `pnpm -r typecheck` 全过（9 个 workspace）
- [ ] `pnpm -r test` 全过（关键逻辑单测覆盖率 ≥ 70%）
- [ ] `pnpm --filter @meimart/api-contract gen:openapi` 后 `git diff --exit-code` 无变更
- [ ] `pnpm --filter @meimart/shared-types gen:types` 后 `git diff --exit-code` 无变更
- [ ] ESLint + Prettier 全过

### 5.2 文件归属
- [ ] 没改其他流程独占的文件（§2.1 / §2.2 / §2.3）
- [ ] 没改 W1 完成的文件（§2.4），如有改动在 manifest §4 报备
- [ ] 共享文件改动全部记录在 manifest §2

### 5.3 命名规范
- [ ] model / migration / schema / 错误码 / i18n 全部遵守 §3

### 5.4 文档同步
- [ ] 新增模块的 README（如适用）
- [ ] 关键决策记录到 Obsidian ADR（如有重大架构调整）
- [ ] CLAUDE.md 是否需要补充（如有新全局约束）

---

## §6. 整合流程（主 AI / 项目负责人执行）

### 6.1 准备

1. 收齐 3 份代码（git remote 或本地路径）+ 3 份 manifest
2. 创建 `integration/w2` 分支，从 W1 完成的 HEAD 切出
3. 准备一个干净的工作目录，三个流程代码分别 clone 到 `w/` `c/` `m/`

### 6.2 整合顺序（按依赖，W → C → M）

#### Step 1: merge 流程 W（被依赖最多）

```bash
cd /integration/w2
git checkout integration/w2
# 拉 W 流程的所有独占文件（直接 copy，无冲突）
rsync -av /integration/w/apps/api/src/modules/warehouse/ apps/api/src/modules/warehouse/
rsync -av /integration/w/apps/api/src/modules/catalog/  apps/api/src/modules/catalog/
# ... 其他 W 独占目录

# 按 W manifest §2 手工合并共享文件
# 1. app.module.ts：加 W 的 Module import + imports 数组项
# 2. schema.prisma：末尾追加 W 的 model
# 3. migrations/：复制 W 的 migration 目录（注意 _w 后缀）
# 4. contract schemas/index.ts：加 W 的 export
# 5. shared-locales/index.ts：加 W 的 bundle
# 6. common.json / errors.json：union 合并 W 的 key

# 验证
pnpm install
pnpm --filter @meimart/api-contract gen:openapi
pnpm --filter @meimart/shared-types gen:types
pnpm -r typecheck && pnpm -r test
```

#### Step 2: merge 流程 C（依赖 W 的商品/仓库数据）

```bash
# 流程 C 独占文件直接 rsync
# 共享文件按 C manifest 合并：
#   - app.module.ts 在 W 的基础上继续加 C 的 Module
#   - schema.prisma 在 W 之后追加 C 的 model（注意 enum 撞名）
#   - migrations/ 复制 C 的（_c 后缀按字母序排在 _w 之后）
#   - contract schemas/index.ts 加 C 的 export
#   - shared-locales/index.ts 加 C 的 bundle
#   - common.json / errors.json union 合并

# 重新生成 + 验证
pnpm --filter @meimart/api-contract gen:openapi
pnpm --filter @meimart/shared-types gen:types
pnpm -r typecheck && pnpm -r test
```

#### Step 3: merge 流程 M（最少依赖）

```bash
# 同 Step 2，加 M 的独占文件 + 共享文件
# 重新生成 + 验证
pnpm --filter @meimart/api-contract gen:openapi
pnpm --filter @meimart/shared-types gen:types
pnpm -r typecheck && pnpm -r test
```

### 6.3 共享文件冲突解决优先级

| 共享文件 | 冲突类型 | 解决策略 |
|---|---|---|
| `app.module.ts` | imports 数组顺序 | 字母序，三方都保留 |
| `schema.prisma` | model 顺序 | W 在前，C 中间，M 末尾 |
| `schema.prisma` | enum 名撞 | 主 AI 决策：合并 enum 或重命名（在 manifest 报备过则按 manifest） |
| `migrations/` | 时间戳撞 | 按 _w → _c → _m 字母序排列，prisma migrate deploy 顺序执行 |
| `schemas/index.ts` | export 顺序 | 字母序，三方都保留 |
| `shared-locales/index.ts` | bundle 字段 | 字母序，三方都保留 |
| `common.json` | key 撞 | 同 key 同值 → 保留；同 key 不同值 → 主 AI 决策 |
| `errors.json` | 错误码撞 | 按 §3.4 分段，理论上不撞；如撞则主 AI 决策 |
| `seed.ts` | 段落顺序 | 按 `// === FLOW W ===` 注释分段，三方各自段内不动 |

### 6.4 最终验证（merge 完成后必跑）

```bash
# 1. 全栈启动
docker compose up -d
pnpm install
pnpm --filter @meimart/api exec prisma migrate deploy
pnpm --filter @meimart/api db:seed

# 2. 全栈验证
pnpm dev  # 4 个 app 都能起
curl http://localhost:3000/health
curl http://localhost:3000/health/ready

# 3. 契约一致性
pnpm --filter @meimart/api-contract gen:openapi
pnpm --filter @meimart/shared-types gen:types
git diff --exit-code  # 应无变更

# 4. 类型 + 测试
pnpm -r typecheck
pnpm -r test

# 5. 三流程冒烟测试（按 W-M-C-T 各流程 acceptance 抽测关键路径）
```

### 6.5 整合失败处理

- 任一共享文件冲突无法自动合并 → 主 AI 停下，与对应流程 AI 沟通（或自行决策并记录到集成日志）
- typecheck / test 失败 → 不进 main，开 `integration/w2-fix` 分支修
- gen:openapi 后 git diff 有变更 → 说明某流程 AI 没 commit 生成的 openapi.yaml，主 AI 手工 commit

---

## §7. 关键提醒

### 7.1 三流程 AI 必须遵守

1. **不碰其他流程独占文件**（§2.1 / §2.2 / §2.3）
2. **不碰 W1 完成文件**（§2.4），如必须扩展（如 auth 加 OTP）在 manifest §4 报备
3. **共享文件改动全部记录在 manifest**（§4）
4. **命名规范严格遵守**（§3），尤其 migration 后缀 `_w` / `_c` / `_m`
5. **PR 自检全过**才能交付（§5）

### 7.2 主 AI 必须遵守

1. **整合顺序：W → C → M**（依赖关系）
2. **每步 merge 后跑全栈验证**（typecheck + test + gen:openapi）
3. **冲突解决按 §6.3 优先级**，不擅自删除任一流程的代码
4. **整合失败不停在原地猜**，开 fix 分支或问对应流程 AI

### 7.3 项目负责人（你）必须确认

1. W1 完成的 HEAD 已打 tag（如 `w1-complete`），三个 AI 都从这个 tag 切分支
2. 三个 AI 各自的 manifest 收齐后再启动整合
3. 整合期不开启三流程的 PR（避免半整合状态）
4. 整合完成后跑一次端到端冒烟（按 W-M-C-T acceptance 抽测）

---

**版本**：v1.0
**生效日期**：2026-06-23
**下次更新触发**：W2 整合完成后复盘 + W3 启动前
