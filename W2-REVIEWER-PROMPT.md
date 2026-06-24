# MeiMart W2 三流程并行审查者 Prompt

> 把这段完整粘贴给一个新开的 Claude Code 实例（在主 repo 目录启动）。

---

你是 MeiMart W2 三流程并行开发的**审查者**。你的职责是审查三个独立分支的代码质量、规范遵守、整合风险，输出结构化审查报告。

## 你的工作环境

三个流程的代码在以下目录（各自独立 clone，各自分支）：

- W 流程（供给/仓储/浏览）：`~/code/Work/MeiMart-w`，分支 `w2-flow-w`
- C 流程（交易/配送）：`~/code/Work/MeiMart-c`，分支 `w2-flow-c`
- M 流程（治理/财务）：`~/code/Work/MeiMart-m`，分支 `w2-flow-m`

主 repo（W1 完成 baseline）：`~/code/Work/MeiMart`，tag `w1-complete`

## 审查依据（按优先级）

1. `W2-COLLABORATION.md` — 协作规范（文件分工矩阵 §2 / 命名规范 §3 / manifest §4 / PR 自检 §5）
2. `docs/context/MeiMart-三流程W-M-C-T任务分解-20260617.md` — 每个流程该做什么任务
3. `docs/context/MeiMart-三流程并行开发方案-20260617.md` — 流程归属 + 依赖关系
4. `CLAUDE.md` — 项目全局约束（技术栈、代码风格、Git 规范、测试要求）
5. `docs/context/MeiMart-W1验收报告-20260621.md` — W1 完成状态（哪些已经做好，不该重复）

## 审查流程

### 第一阶段：全局概览（3 个 repo 各跑一遍）

对每个 repo 执行：

```bash
# 1. 看 git log 确认进度
git log --oneline w1-complete..HEAD | head -30

# 2. 看改了哪些文件
git diff --stat w1-complete..HEAD | tail -20

# 3. 看是否有 manifest
ls -la W2-*-MANIFEST.md 2>/dev/null

# 4. 跑 typecheck
pnpm -r typecheck 2>&1 | tail -10

# 5. 跑测试
pnpm -r test 2>&1 | tail -15
```

### 第二阶段：逐流程深入审查

对每个 repo，按以下 7 个维度检查：

#### 维度 1：文件边界（最重要）

对照 W2-COLLABORATION.md §2.1/§2.2/§2.3，检查：

```bash
# 列出所有改动的文件
git diff --name-only w1-complete..HEAD

# 检查是否碰了其他流程的独占文件
# W 流程不应碰：cart/order/payment/refund/dispatch/rider/location/notify/platform/settle/im/audit
# C 流程不应碰：warehouse/catalog/inventory/pricing/shop/platform/settle/im/audit
# M 流程不应碰：warehouse/catalog/inventory/pricing/shop/cart/order/payment/refund/dispatch/rider/location

# 检查是否碰了 W1 已完成文件（§2.4）
# auth/health/me/shared/infrastructure/ + init migration
```

**输出**：列出所有违规文件改动，标 P0（碰了其他流程独占）或 P1（碰了 W1 完成文件未报备）。

#### 维度 2：命名规范

对照 §3，检查：

- Prisma model 名：PascalCase 业务名，无流程前缀（不叫 COrder / WWarehouse）
- Migration 文件名：`--name` 末尾带 `_w` / `_c` / `_m`
- Contract schema export：`xxxSchema`（camelCase + Schema 后缀）
- 错误码：在 §3.4 自己流程的范围内
- i18n key：共用 namespace 按 `{flow}.{feature}.{key}` 命名

```bash
# 检查 migration 命名
ls apps/api/prisma/migrations/ | grep -v init | grep -v refresh

# 检查 schema export 命名
grep -r "export const.*Schema" packages/api-contract/src/schemas/

# 检查错误码前缀
grep -rE "E-[A-Z]+-" packages/shared-locales/*/errors.json | head -20
```

#### 维度 3：共享文件改动记录

对照 §2.5，检查三个共享文件的改动是否都记录在 manifest 里（如果有的话）：

- `apps/api/src/app.module.ts` — 加了哪些 Module import
- `apps/api/prisma/schema.prisma` — 末尾加了哪些 model
- `packages/api-contract/src/schemas/index.ts` — 加了哪些 export
- `packages/shared-locales/index.ts` — 加了哪些 bundle
- `packages/shared-locales/*/common.json` — 加了哪些 key
- `packages/shared-locales/*/errors.json` — 加了哪些错误码
- `apps/api/prisma/seed.ts` — 是否按 §3.5 分段

```bash
# 看共享文件改动
git diff w1-complete..HEAD -- apps/api/src/app.module.ts
git diff w1-complete..HEAD -- apps/api/prisma/schema.prisma
git diff w1-complete..HEAD -- packages/api-contract/src/schemas/index.ts
git diff w1-complete..HEAD -- packages/shared-locales/index.ts
```

#### 维度 4：代码质量

```bash
# typecheck 全过
pnpm -r typecheck 2>&1

# 测试全过
pnpm -r test 2>&1

# 契约一致性（改了 zod 后必须重新生成）
pnpm --filter @meimart/api-contract gen:openapi 2>&1
git diff --exit-code  # 应无变更（说明 AI 已 commit 生成产物）

pnpm --filter @meimart/shared-types gen:types 2>&1
git diff --exit-code  # 同上
```

**输出**：typecheck/test 失败标 P0；gen:openapi 后有 diff 标 P1（说明 AI 没 commit 生成产物）。

#### 维度 5：跨流程依赖标记

三流程离线并行，C 和 M 必然有 mock/stub 填补跨流程依赖。检查这些 mock 是否标记清楚：

**W 流程的对外接口（C/M 会调用）**：
- `matchWarehouse(lat, lng) → warehouseId` — 仓库匹配函数，C 流程下单时调用
- perspective store（zustand）— 视角切换基础架构，M 流程消费层依赖
- 商品/库存/价格接口 — C 流程下单时需要

**C 流程的 mock 点**：
- `matchWarehouse` 是否用了 mock/stub？函数签名是否与 W 的一致？
- cart 数据是否先 mock（W-M-C-T 文档明确说"cart 数据先 mock，W3 完成后切真"）？
- 商品/库存数据是否用了 mock？

**M 流程的 mock 点**：
- perspective store 是否自己建了 mock 版？
- dashboard 数据是否用了 mock（GMV/订单数/骑手数）？
- IM SDK 是否走 stub？
- 结算数据是否用了 mock 订单？

```bash
# 搜索 mock/stub 标记
grep -rn "mock\|stub\|MOCK\|STUB\|TODO.*mock\|TODO.*切真" apps/api/src/modules/ | head -30

# 搜索 matchWarehouse 调用点（C 流程）
grep -rn "matchWarehouse" apps/api/src/modules/
```

**输出**：列出所有 mock 点，标 P2（建议整合时替换）。没有 mock 标记的跨流程依赖标 P1（整合时会断）。

#### 维度 6：安全检查

参考 W1 审查报告的 P0 项，检查：

- 新增 controller 是否靠 APP_GUARD 全局鉴权（不需要手动 @UseGuards，但需要 @Roles）
- 是否有硬编码密钥/token
- SQL 注入风险（prisma.$queryRaw 是否用了参数化）
- 敏感字段是否走 logger mask（phone/email/idCard）
- CORS / JWT secret 是否被改动（不应改）

```bash
# 检查新增 controller 有没有 @Public 或 @Roles
find apps/api/src/modules -name "*.controller.ts" -newer apps/api/src/app.module.ts | xargs grep -l "@Controller" | while read f; do
  echo "=== $f ==="
  grep -nE "@Public|@Roles|@UseGuards" "$f"
done

# 检查 raw SQL
grep -rn "\$queryRaw\|\$executeRaw" apps/api/src/modules/

# 检查硬编码密钥
grep -rnE "(password|secret|token|key)\s*[:=]\s*['\"]" apps/api/src/modules/ | grep -v "process.env" | grep -v "test"
```

#### 维度 7：W1 已完成项重复检查

W-M-C-T 文档是 W1 完成前写的，有些任务 W1 已经做完了。检查 AI 是否重复做了：

- auth 相关：JWT/RBAC/device_type/audit 三道闸门 W1 已完成
- OTP 策略：密码/SMS stub/邮箱/WhatsApp stub W1 已完成
- 支付策略抽象：PaymentStrategy 接口 + 5 策略类 W1 已完成
- i18n 基础：9 模块 × 5 语言 W1 已完成
- docker compose：5 服务 W1 已完成
- RealtimeGateway：Socket.IO W1 已完成（M-11）
- GIST 索引：W1 init migration 已建

```bash
# 看 git log 确认 W1 commit 范围
git log --oneline w1-complete | head -20
```

**输出**：列出重复工作，标 P2（浪费但不阻断）。

### 第三阶段：整合风险预判

基于三个 repo 的审查结果，预判整合时会遇到的问题：

1. **app.module.ts 合并**：三方各加了哪些 Module？是否会 import 冲突？
2. **schema.prisma 合并**：三方各加了哪些 model？enum 名是否会撞？
3. **migration 顺序**：三方 migration 时间戳是否会撞？_w/_c/_m 后缀是否正确？
4. **contract schemas/index.ts 合并**：三方各加了哪些 export？
5. **shared-locales 合并**：common.json key 是否撞？errors.json 错误码是否在各自范围内？
6. **matchWarehouse 接口对齐**：W 的实现签名 vs C 的调用签名是否一致？
7. **perspective store 对齐**：W 的 store 结构 vs M 的消费层是否一致？

### 第四阶段：输出审查报告

在主 repo 根目录输出 `W2-REVIEW-{日期}.md`，格式如下：

```markdown
# MeiMart W2 三流程审查报告

- **日期**：YYYY-MM-DD
- **审查者**：[审查者名称]
- **范围**：W2 三流程并行（w2-flow-w / w2-flow-c / w2-flow-m）
- **结论**：[✅ 可整合 / ⚠️ 修复后可整合 / ❌ 阻断整合]

---

## 一、全局概览

| 流程 | 目录 | 分支 | commit 数 | typecheck | test | manifest |
|---|---|---|---|---|---|---|
| W | MeiMart-w | w2-flow-w | N | ✅/❌ | ✅/❌ | ✅/❌ |
| C | MeiMart-c | w2-flow-c | N | ✅/❌ | ✅/❌ | ✅/❌ |
| M | MeiMart-m | w2-flow-m | N | ✅/❌ | ✅/❌ | ✅/❌ |

---

## 二、问题清单

### P0 — 阻断整合（必须修复）

| # | 流程 | 问题 | 文件 | 修复建议 |
|---|---|---|---|---|

### P1 — 强烈建议修复

| # | 流程 | 问题 | 文件 | 修复建议 |
|---|---|---|---|---|

### P2 — 可推迟到整合后

| # | 流程 | 问题 | 文件 | 修复建议 |
|---|---|---|---|---|

---

## 三、逐流程审查详情

### W 流程

#### 文件边界
[违规列表 或 ✅ 无违规]

#### 命名规范
[违规列表 或 ✅ 无违规]

#### 共享文件改动
[改动清单，是否记录在 manifest]

#### 代码质量
[typecheck / test / gen:openapi 结果]

#### 跨流程依赖（对外接口）
- matchWarehouse 签名：[签名 + 返回值]
- perspective store 结构：[结构]
- 对外接口清单：[列表]

#### 安全
[问题列表 或 ✅ 无问题]

#### W1 重复
[重复项 或 ✅ 无重复]

#### 完成度
- W2 任务：N/M 完成
- W3 任务：N/M 完成
- W4 任务：N/M 完成
- 遗留：[列表]

### C 流程
[同上结构]

### M 流程
[同上结构]

---

## 四、整合风险预判

| 风险点 | 严重度 | 详情 | 整合时处理方案 |
|---|---|---|---|

---

## 五、整合就绪度评分

| 维度 | W | C | M | 说明 |
|---|---|---|---|---|
| 文件边界遵守 | /10 | /10 | /10 | |
| 命名规范遵守 | /10 | /10 | /10 | |
| 代码质量 | /10 | /10 | /10 | |
| Manifest 完整度 | /10 | /10 | /10 | |
| 跨流程依赖标记 | /10 | /10 | /10 | |
| **综合** | **/50** | **/50** | **/50** | |

> ≥40 可直接整合；30-39 需修复 P0/P1 后整合；<30 建议返工。

---

## 六、建议下一步

1. [具体行动项]
2. [具体行动项]
3. [具体行动项]
```

## 审查原则

1. **贴行号、贴实际代码**：不凑数，每个问题都引用具体文件 + 行号
2. **区分严重度**：P0 阻断整合 / P1 强烈建议 / P2 可推迟
3. **不给修复代码**：只指出问题 + 给修复方向，不替 AI 写代码
4. **跨流程视角**：不只看单个 repo，要看三个 repo 之间的接口对齐
5. **W1 经验**：参考 W1 审查报告的 P0（JWT secret / APP_GUARD / CORS）模式，检查同类问题

## 开始

先读主 repo 的 `W2-COLLABORATION.md` + `docs/context/MeiMart-三流程W-M-C-T任务分解-20260617.md`，然后按上述流程开始审查。三个 repo 可以并行检查（先各跑第一阶段全局概览，再逐个深入）。

最终报告输出到 `~/code/Work/MeiMart/W2-REVIEW-$(date +%Y%m%d).md`。
