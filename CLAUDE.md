# MeiMart — Claude Code 项目指令

> 项目当前阶段:**W1 共享前置层**(D0-D7, 7 个工作日)。
> 权威任务清单:`/Users/linsuwei/DevAll/Obsidian/Work-Wiki/Work-Wiki/_inbox/04-后端记录/MeiMart-W1共享前置层-AI执行版-20260617.md`

---

## 🎯 项目概述

- **项目**:MeiMart — 东帝汶超市电商 MVP(客户端 App + 骑手 App + 后台 Web)
- **市场**:东帝汶(Asia/Dili, UTC+9, 官方货币 USD)
- **团队**:1 人全栈(linsuwei)
- **周期**:8 周完成 MVP(W1 共享前置层 → W2-W6 三流程并行 → W7-W8 验收上线)

---

## 🧱 四项业务决策(任何方案都要符合)

1. **单一商家**:`shops` 表预置 1 条(平台自营),入驻接口留口但 MVP 不开放
2. **多仓库**:5-10 个,按地理位置,PostGIS 匹配最近仓库,订单实体含 `warehouse_id`
3. **视角切换**:`super_admin` 同一 JWT,前端切 5 视角(平台/商家/仓库/客服/骑手管理),后端不感知,**仅靠 `X-Perspective` header 做审计**
4. **一人全栈**:契约简化(非法律契约,是个人备忘),无 PR 评审但有 self-review,失败立即停下问用户

---

## 🛠️ 技术栈(锁定,不要替换)

| 维度 | 选型 |
|---|---|
| Monorepo | pnpm workspace + Turborepo |
| Runtime | Node.js 20+ |
| Backend | NestJS 10 + Prisma 5 |
| Database | PostgreSQL 16 + PostGIS 3.4(**用 prisma-raw 适配**) |
| Cache/MQ | Redis 7 + BullMQ |
| 契约 | zod + @asteasolutions/zod-to-openapi |
| Admin Web | Next.js 14(App Router) + shadcn/ui + next-intl |
| App | React Native + Expo + i18next |
| WebSocket | Socket.IO |
| CI/CD | GitHub Actions |
| 容器 | Docker Compose |
| 监控 | Sentry + pino |

---

## 💳 外部服务(锁定)

> **重要前提**:**MVP 测试阶段全走个人账号,无海外营业执照**。所有需要海外主体的服务走 mock 或接口预留。

### 主体与外部服务策略矩阵

| 服务 | 测试阶段方案(MVP) | 真实接入条件 |
|---|---|---|
| **公司主体** | 无(个人账号) | 后期补:国内个体户/Stripe Atlas/东帝汶本地合伙 |
| **COD 货到付款** | ✅ 真实流程(骑手送达收款) | 无需主体 |
| **本地银行转账** | ✅ 真实流程(凭证上传 + 人工对账) | 无需主体 |
| **微信支付** | 🟡 **Mock 实现**(返回"支付成功"假数据) | 后期挂靠国内个体户再补真实商户号 |
| **PayPal** | 🟡 **接口预留**(stub 返回成功) | 后期 PayPal Business 或 Stripe Atlas |
| **Stripe** | 🟡 **接口预留**(stub 返回成功) | Stripe Atlas 注册美国 LLC 后再接 |
| **Google Maps** | ✅ 个人 Google 账号 + 国内 Visa/Master | 配额 28k/月,MVP 够用 |
| **WhatsApp Business API** | 🟡 **接口预留**(stub 返回验证码 123456) | 拿到主体后申请 |
| **OTP** | ✅ 密码登录(主)+ SMS 验证码(手机验证)+ 邮箱验证码(找回密码) | SMS 测试 stub,W6 接本地服务商 |
| **SMS** | 🟡 **测试 stub**(固定 123456,日志标 `[SMS_STUB]`)→ W6 切 **东帝汶本地**(Timor Telecom / Telkomcel) | 倾向本地 C 路线,贵价 Twilio 兜底 |
| **i18n** | ✅ 4 语言 `en / id / zh / pt` + Tetum 留接口空翻译 | 无外部依赖 |

**关键设计原则**:所有外部服务走 **interface 抽象**,dev/staging 全 mock,生产环境按服务可用性逐个切真。

### 测试阶段 OTP 完整方案(2026-06-19 决策)
- **主登录**:账号 + 密码(密码强度 ≥ 8 位 + 字母+数字)
- **手机验证**:SMS 验证码(测试 stub 固定 123456,日志标 `[SMS_STUB]`;W6 切东帝汶本地 Timor Telecom/Telkomcel)
- **找回密码**:邮箱验证码(SMTP 用 MailHog dev / SendGrid prod)
- **预留接口**:`OtpStrategy` 抽象,4 策略:`PasswordStrategy` + `SmsStrategy` + `EmailStrategy` + `WhatsAppStrategy`(W6 接入)

### 测试阶段支付完整方案
- **COD**:订单状态机含 `DELIVERED_PAID`(骑手送达时确认收款)+ `DELIVERED_UNPAID`(拒付)
- **银行转账**:用户上传凭证 → 后端存 OSS → admin-web 仓库视角手动确认 → 订单进 CONFIRMED
- **微信支付 mock**:`WechatStrategy.createPayment()` 直接返回 `{ success: true, mockTransactionId: 'MOCK_' + uuid }`,前端跳转"支付成功"页
- **PayPal stub**:`PaypalStrategy.createPayment()` 返回 mock URL,前端打开假页面
- **预留接口**:`PaymentStrategy` 抽象,W6-W7 拿到主体后逐个切真

---

## 📁 目录结构(目标)

```
/Users/linsuwei/code/Work/MeiMart
├── apps/
│   ├── api/             # NestJS
│   ├── admin-web/       # Next.js
│   ├── client-app/      # RN + Expo
│   └── rider-app/       # RN + Expo
├── packages/
│   ├── api-contract/    # zod 源 + OpenAPI + Mock Server
│   ├── shared-types/    # 自动生成 + 错误码
│   ├── shared-utils/    # 工具 + 单测
│   ├── shared-locales/  # i18n 翻译
│   └── ui-kit/          # shadcn 二次封装
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── CLAUDE.md            # 本文件
```

包名统一:`@meimart/<name>`

---

## 🌏 服务器部署

- **区域**:印尼雅加达(AWS ap-southeast-3 / Aliyun 印尼节点)
- **理由**:到东帝汶延迟 < 50ms,合规简单,无数据本地化强制要求
- **域名**:`.com` 优先(W7-W8 上线前定)
- **后置**:东帝汶本地服务器(MVP 后期合规要求时再迁)

---

## ⚙️ 全局约束(必须遵守)

### 1. 代码风格
- ESLint + Prettier,严格执行
- **严禁硬编码字符串**,所有 UI 文案用 i18n key
- 函数级 JSDoc,中文注释
- 时间/货币/数字格式用 `Intl` API,**不要手写格式化**

### 2. Git & Commit
- `main` 受保护,所有改动走 feature branch → self-review → squash merge
- 每个 task 单独 commit,中文 message,格式:`[W1-D{n}-T{n}] 简述`
- 例:`[W1-D2-T3] 完成 Prisma schema 设计与 PostGIS 适配`

### 3. 数据库 Migration
- **一旦 apply 不能修改**,只能新增 migration 修正
- PostGIS GIST 索引走 raw SQL:`prisma migrate dev --create-only` → 手改 SQL → `prisma migrate dev`

### 4. 测试
- 关键逻辑必须单测(Vitest),覆盖率 ≥ 70%
- 鉴权 / 支付 / 库存 必须有 e2e 测试
- PostGIS 单测用 testcontainers 起真实容器,**禁止 mock PostGIS 函数**

### 5. 失败处理
- 任务失败**不要重试**,看 `failure_mode` 回退或停下问用户
- 阻断 W2 启动的失败 → 立即报告用户
- W2 启动最低门槛(不能砍):鉴权 + 契约 + DB schema + 三端登录页 + docker compose + i18n 基础

### 6. i18n 约束
- 翻译文件:`packages/shared-locales/<lang>/common.json`
- 后端错误消息 → 用错误码 `E-MODULE-NUMBER`,前端查 i18n key 显示
- 错误码格式:`E-AUTH-001` / `E-ORDER-042` / `E-PAYMENT-003` 等
- 前端 fetch wrapper 自动注入 `Accept-Language` 和 `X-Perspective` header

---

## 📚 上下文文件清单(改方案前先读)

> 全部在 `/Users/linsuwei/DevAll/Obsidian/Work-Wiki/Work-Wiki/_inbox/04-后端记录/` 下

| 文件 | 用途 |
|---|---|
| **W1 任务清单** | `MeiMart-W1共享前置层-AI执行版-20260617.md` — 36 个原子任务,DAG,验收清单 |
| **W-M-C-T 任务分解** | `MeiMart-三流程W-M-C-T任务分解-20260617.md` — W2-W8 三流程并行任务 |
| **契约 v0.2** | `API契约文档-v0.2.md` — 基础契约(读全) |
| **契约 v0.3** | `API契约文档-v0.3.md` — 决策变更汇总(冲突处以此为准) |
| **17 模块详细** | `MeiMart-17个功能模块详细划分-20260617.md` — 产品功能模块 |
| **三流程方案** | `MeiMart-三流程并行开发方案-20260617.md` — 三流程并行节奏 |
| **W2 协作规范** | `MeiMart-W2三流程协作规范-20260623.md` — W2 三流程离线并行协作规范（项目根副本 `W2-COLLABORATION.md`）**W2 启动前必读** |
| **东帝汶本地化清单** | `MeiMart-东帝汶本地化调研清单-20260617.md` — 法律/支付/语言/地图调研 |
| **后端架构框架** | `MeiMart-后端整体架构框架-20260617.md` — 5 层架构总览 |
| **代码模块拆分** | `MeiMart-后端代码模块与三端功能拆分-20260617.md` — 21 模块清单 |
| **schema 草稿** | `schema.prisma` — 2026-06-16 已有草稿,作参考(可能与最新设计有差异) |
| **技术栈选型** | `技术栈选型与问题深度分析.md` — 选型推理过程 |
| **代码规范** | `规范整理.md` — 项目代码规范 |

---

## 🚀 W1 启动指令

> **W1 已于 2026-06-21 完成验收**（HEAD 见最后一个 `[W1-*]` commit）。下方为历史启动指令，W2 三流程任务请直接看下一节"W2 启动指令"。

进入项目后,按以下顺序执行:

```
1. 读 MeiMart-W1共享前置层-AI执行版-20260617.md 全文(36 任务 + DAG)
2. 读 API契约文档-v0.2.md(基础契约) + API契约文档-v0.3.md(变更覆盖)
3. 读 MeiMart-东帝汶本地化调研清单-20260617.md(外部依赖与法律风险)
4. **D0 已跳过**(2026-06-19 决策):外部账号申请 + 真实数据准备延后到 W6
   - 当前阶段:全部用 mock/stub,登录用虚拟账号,接口预留外部服务
   - 直接进 D1-T1 创建 monorepo
5. 按 D1 → ... → D7 顺序执行,每个 task:
   a. 运行 acceptance 命令验证
   b. 通过 → git commit -m "[W1-D{n}-T{n}] 简述"
   c. 失败 → 看 failure_mode,无预案停下问用户
6. D7 收尾时,写 MeiMart-W1验收报告-YYYYMMDD.md
7. 全部 ✅ → 提示"W1 完成,可进 W2"
8. 中断恢复:看 `git log --oneline | head -20` 找最后一个 [W1-*] commit
```

---

## 🚀 W2 启动指令（三流程并行）

**W2 进入条件**：W1 验收通过（HEAD 见最后一个 `[W1-D7-fix-*]` commit）。

### 如果你是三流程之一（W / C / M）

```
1. 读项目根 W2-COLLABORATION.md 全文（必读！决定你的工作边界）
2. 读 Obsidian MeiMart-三流程并行开发方案-20260617.md（找自己流程的章节）
3. 读 Obsidian MeiMart-三流程W-M-C-T任务分解-20260617.md（找自己流程的 W-M-C-T 任务）
4. 确认你的流程代号（W / C / M）和独占范围（W2-COLLABORATION.md §2）
5. 按 W-M-C-T 任务分解执行，遵守：
   - 文件分工矩阵（§2，不碰其他流程独占 + W1 完成的文件）
   - 命名规范（§3，尤其 migration 后缀 _w / _c / _m）
   - PR 自检 checklist（§5）
6. 完成时输出 W2-{FLOW}-MANIFEST.md（§4 模板）
```

### 如果你是主 AI（整合 3 份代码）

```
1. 收齐 3 份代码 + 3 份 manifest
2. 读 W2-COLLABORATION.md §6 整合流程
3. 按 W → C → M 顺序整合，每步跑全栈验证
4. 整合失败按 §6.5 处理（不停在原地猜）
5. 整合完成跑 §6.4 最终验证 + 端到端冒烟
```

---

## 🔧 常用命令

```bash
# 启动本地全栈
docker compose up -d                           # postgres+postgis, redis, minio, mailhog
pnpm install
pnpm --filter @meimart/api prisma migrate dev
pnpm --filter @meimart/api db:seed
pnpm dev                                       # 同时起 4 个 app

# 契约生成链路(改 zod 后必跑)
pnpm --filter @meimart/api-contract gen:openapi
pnpm --filter @meimart/shared-types gen:types
pnpm typecheck                                 # 三端类型同步检查

# 测试
pnpm test                                      # 全部单测
pnpm --filter @meimart/api test:e2e            # 后端 e2e
pnpm --filter @meimart/shared-utils test:coverage

# 数据库
pnpm --filter @meimart/api prisma studio       # 数据浏览
pnpm --filter @meimart/api prisma migrate dev --create-only --name <name>  # 生成空 migration 手改

# Mock Server(给三端联调用)
pnpm --filter @meimart/api-contract mock
```

---

## ⚠️ 已知风险(高风险项)

| 风险 | 应对 |
|---|---|
| **无海外营业执照,大量外部服务受限** | MVP 全走个人账号 + interface 抽象,生产环境用 mock 顶,后期补主体逐个切真 |
| **微信支付用 mock,生产不能真实收款** | 测试阶段 OK,W7 上线前必须决断:挂靠国内个体户 vs 永久跳过 |
| **Google Maps 个人 key 配额 28k/月** | MVP DAU 5000 估算够用,但压测时注意限速 |
| **SMS 完全跳过,部分场景 OTP 无解** | ❌ 已推翻:**改为接入**。测试 stub,W6 切东帝汶本地 Timor Telecom/Telkomcel,密码 + SMS + 邮箱三策略覆盖 |
| **PostGIS + Prisma 兼容** | 锁定 prisma-raw + helper 函数,必要时退化为 GeoHash |
| **法律主体未确认** | **W1 D0 找律师**,W6 末必须有结论 |
| **印尼雅加达服务器到东帝汶延迟** | W1 D6 部署后实测,< 100ms 可接受 |
| **数据备份** | D6-T5 必须做 restore 演练 + 失败 alert |

---

## 🎨 视角切换(关键设计)

- **JWT 不含视角,不含 clientType**:`payload = { sub, role, deviceType, jti }`,删 clientType(冗余)
- **deviceType 取值**:`client_app` / `rider_app` / `admin_web`,前端 App 配置写死,服务端用于审计 + token 策略
- **role 取值**(5 个真实角色):`super_admin` / `customer` / `rider` / `warehouse_staff` / `customer_service`
- **前端切视角**:zustand state 持久化 `perspective`,5 个值:`platform / merchant / warehouse / support / rider-mgmt`
- fetch/axios interceptor 自动注入 `X-Perspective` header + `Accept-Language` header
- 后端审计拦截器读 header,写 AuditLog 表(`before/after/perspective/deviceType` 字段)
- **后端 RBAC 不感知 perspective**,只看 role
- 切换视角时 reset 业务 state,避免脏数据

## 🔐 Token 策略(2026-06-19 决策)

- **分端 TTL**:客户端 access 30d / 骑手 12h / 后台 2h;refresh 统一 60d
- **logout 必传 refreshToken**:服务端加 Redis 黑名单,refresh 立即失效
- **JWT 含 jti**:唯一 ID,用于 logout 黑名单定位
- accessToken 自然过期(不能服务端 revoke,等过期或 refresh)

## 📦 orderNo 格式(2026-06-19 决策)

- `MM + yyyyMMdd + warehouseId(2位) + 序号(4位)` = 16 位
- 例:`MM2026061901000234`(2026-06-19,W01,当日第 234 单)
- 序号由 Redis `INCR order:seq:{date}:{whCode}` 生成,2 天过期,跨日重置
- 单仓单日上限 9999 单(MVP 远超需求)

---

## 📦 数据库表清单(W1 基线 16 张)

`User` · `UserRole` · `Shop` · `Warehouse`(含 PostGIS) · `Product`(i18n JSON) · `Sku` · `Stock`(warehouseId+skuId) · `StockLog` · `Order`(含 warehouseId) · `OrderItem` · `OrderEvent` · `AuditLog`(含 perspective/deviceType) · `PaymentIntent`(5 枚举) · `IdempotencyKey` · `RiderLocation` · `RiderLocationHistory`

## 🌐 多语言字段(2026-06-19 决策)

- 所有需要多语言的字段(`name` / `description` / `title` 等)统一用 JSON:`Record<string, string>`
- 例:`{ "en": "Milk", "zh": "牛奶", "id": "Susu", "pt": "Leite" }`
- 支持语言:`en / id / zh / pt`,Tetum 留 key 但翻译值空字符串
- 查询时按 `Accept-Language` header 取值,fallback 链:`lang → en → 空字符串`

## 🚀 配送追踪(2026-06-19 决策)

- **双轨**:Socket.IO WS 实时推送 + HTTP 轮询兜底
- WS:骑手 App 每 5s 推位置 → 服务端 → 客户端 App 实时显示
- HTTP 轮询:`GET /orders/:id/tracking` 间隔 30s,WS 断线时降级
- 客户端 App 启动时同时开 WS + 定时器,WS 收到消息就重置定时器

---

## 🔄 W1 完成判据(全勾才进 W2)

```
□ pnpm dev 4 个 app 都能起
□ Swagger UI 显示 W2 用到的所有接口
□ docker compose up 一键起全栈
□ pg_dump 备份定时任务 + restore 演练
□ 16 张基线表已迁移,种子数据可登录
□ coverageArea GIST 索引已建(EXPLAIN 验证)
□ Mock 登录三端可用,JWT 含 deviceType(无 clientType)
□ RBAC + device_type + audit e2e 通过
□ i18n 三端接入,英语 ~120 key 完整
□ PaymentStrategy 抽象完成,5 策略(2 真+3 mock/stub)全到位
□ OtpStrategy 抽象完成,密码 + SMS(stub) + 邮箱全到位
□ Google Maps SDK 封装(用真实个人 key)
□ Socket.IO WS 通道打通(骑手位置推送链路) ✅ 2026-06-23
□ orderNo 生成器单测覆盖(16 位格式)
□ logout 接口能精准 invalidate refresh token
□ CI 全绿,merge to main 自动部署 staging(印尼雅加达)
□ Sentry 接入,trace_id 贯穿
```

任一项未达标 → **不进 W2**,在 W1 验收报告里补补救计划。

---

## 📞 联系与升级

- 项目负责人:linsuwei(你)
- 任务跟踪:Claude Code 内置 TaskCreate(本会话内)+ Obsidian 文档(跨会话)
- 任何方案变更 → 同步更新对应 Obsidian md + 本 CLAUDE.md
