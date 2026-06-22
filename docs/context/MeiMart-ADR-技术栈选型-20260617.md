---
title: MeiMart ADR — 技术栈选型
date: 2026-06-20
status: 已决
deciders: linsuwei
related:
  - "[[MeiMart-CLAUDE-20260618]]"
  - "[[API契约文档-v0.2]]"
  - "[[API契约文档-v0.3]]"
  - "[[MeiMart-W1共享前置层-AI执行版-20260617]]"
tags: [MeiMart, ADR, 技术栈, MVP]
---

# MeiMart ADR — 技术栈选型

> 本文记录 MeiMart MVP 阶段的技术栈决策。每项写"为什么选 X / 为什么不选 Y"，并标注"MVP 阶段实现程度"与"未来切真条件"。
>
> **核心约束（不可推翻）**：MVP 测试阶段全走个人账号，无海外营业执照；所有需要海外主体的服务走 mock 或接口预留。
>
> 决策日期：2026-06-20（D1-T4 落档，依据 v0.3 决策汇总）

---

## 一、Monorepo 与 Runtime

### 选型：pnpm workspace + Turborepo / Node.js 20+

**为什么选 pnpm + Turborepo**
- pnpm 的硬链接节省磁盘 + 安装快（关键，单人开发每天多端构建）
- workspace 协议（`workspace:*`）让 9 个子包共享 `@meimart/*` 软链
- Turborepo 的任务缓存（`^build` 依赖）让 `pnpm typecheck` 不重复跑未改动的包
- 单仓库单 PR，符合"一人全栈"协作模式

**为什么不选**
- ❌ Nx：脚本能力更强但学习成本高，MVP 9 包不需要它的 generator
- ❌ Lerna：维护已放缓，被 pnpm + Turborepo 取代
- ❌ Yarn Workspaces：node_modules 结构不如 pnpm 严格，幽灵依赖
- ❌ 多仓库（polyrepo）：跨端共享类型（shared-types）成本太高

### Runtime：Node.js 20+（实际用 22 LTS）

**为什么 20+**：NestJS 10 / Next.js 14 / Prisma 5 都要求 Node 18+，20+ 留足兼容余量。
**为什么 22**：本地环境已是 22.22.3，不刻意降版。

---

## 二、后端

### 选型：NestJS 10 + Prisma 5

**为什么选 NestJS**
- 模块化单体（Modular Monolith）天然适配 MeiMart 17 模块划分
- DI + 装饰器 + Guard/Interceptor/Pipe 三件套，鉴权/审计/校验代码组织清晰
- TypeScript 一等公民，类型安全贯穿
- 文档生态成熟，单人开发降低心智负担

**为什么不选**
- ❌ Express/Koa 裸写：单人开发重复造轮子，鉴权/校验/ OpenAPI 都要自己接
- ❌ Fastify（独立用）：性能高但生态比 NestJS 小，工具链拼接成本高
- ❌ Midway/Hydra：国内生态，文档不全
- ⚠️ 风险：NestJS 启动重——已识别，W1 D4-T1 失败模式有"退到 Fastify adapter"

**为什么选 Prisma**
- Schema-first，类型自动生成，与 zod schema 双向校验可行
- Migration 工具完善（D2-T4 关键依赖）
- TypeScript 类型贯穿数据库到 API

**为什么不选**
- ❌ TypeORM：装饰器 + Active Record 风格陈旧，类型推断不如 Prisma
- ❌ Sequelize：维护放缓
- ❌ Kysely / Drizzle：query builder 风格灵活但单人开发心智成本高

### PostGIS 适配方案（关键决策）

**问题**：Prisma 5 原生不支持 PostGIS 空间类型与 GIST 索引。

**方案**：prisma-raw + helper 函数
- `schema.prisma` 中地理字段用 `Unsupported("geometry(Point,4326)")?` / `Unsupported("geometry(Polygon,4326)")?`
- 写入/查询用 `prisma.$queryRaw` + `ST_SetSRID/ST_MakePoint/ST_Within`
- 封装 `apps/api/src/shared/db/postgis-helpers.ts`：`createPoint / findWarehouseByPoint / createPolygon`
- GIST 索引走 raw SQL migration：`prisma migrate dev --create-only` → 手改 SQL → apply

**为什么不选**
- ❌ 退化为 GeoHash（字符串前缀匹配）：仓库覆盖多边形无法表达，精度损失
- ❌ 等 Prisma 6 原生支持：不可控时间表，MVP 不能等
- ❌ MongoDB + 2dsphere：换数据库代价过大，且事务能力不如 PG

**保险**：D2-T3 PostGIS helper 单测用 testcontainers 起真实 `postgis/postgis:16-3.4` 容器，**禁止 mock PostGIS 函数**。

---

## 三、数据库与缓存

### 数据库：PostgreSQL 16 + PostGIS 3.4

**为什么选**
- 16 是当前 LTS，JSON 字段性能优化完善（多语言字段 `Record<string,string>` 大量使用）
- PostGIS 3.4 是 PG 16 兼容版本，ST_Within/GIST 索引就绪
- 单一数据库同时支撑关系数据 + 空间数据 + JSON 多语言

**为什么不选**
- ❌ MySQL：空间索引精度差，多语言 JSON 字段弱
- ❌ MongoDB：事务弱，骑手位置 UPSERT 频繁写入需要原子性
- ❌ 单独再起一个空间数据库（PostGIS alone）：运维复杂

### 缓存/MQ：Redis 7 + BullMQ

**为什么选 Redis**
- 三用合一：会话/JWT 黑名单 + BullMQ 队列 + orderNo 序号生成（`INCR`）
- 单机 Docker Compose 一键起
- BullMQ 是 NestJS 生态首选队列

**为什么不选**
- ❌ RabbitMQ/Kafka：MVP 流量级（DAU 5000）不需要，运维重
- ❌ Redis Streams（不用 BullMQ）：手动实现重试/延迟队列成本高

---

## 四、契约层

### 选型：zod + @asteasolutions/zod-to-openapi

**为什么选**
- zod schema 同时是：API 校验 + OpenAPI 生成源 + TS 类型源
- 单人开发，契约从"多方合同"简化为"个人备忘录 + 类型生成器"，但严肃性不能降
- `@asteasolutions/zod-to-openapi` 是 zod→OpenAPI 转换最完整的库（官方 zod-openapi 是 fork）

**为什么不选**
- ❌ TypeBox + Fastify：换 runtime，成本高
- ❌ 手写 OpenAPI YAML + openapi-typescript：维护负担大，schema 与代码易脱节
- ❌ tRPC：纯 TS 端到端，但 RN/Next/NestJS 三端契约打通复杂

### Mock Server：Prism

- 基于 OpenAPI 起 Mock Server，三端联调用
- D6-T4 接入

---

## 五、前端

### Admin Web：Next.js 14（App Router）+ shadcn/ui + next-intl

**为什么选**
- App Router 是 Next 主推方向，Server Components 利于后台首屏性能
- shadcn/ui 是"复制源码"模式，可定制性远超 Material UI/Ant Design
- next-intl 是 App Router 兼容性最好的 i18n 方案

**为什么不选**
- ❌ Ant Design Pro：包大、设计语言陈旧、定制难
- ❌ Vue/Nuxt：单人栈一致性差（后端已是 TS/NestJS）
- ❌ Refine/Retool：后台逻辑定制需求高（视角切换器），低代码方案不灵活

### App（客户端 + 骑手）：React Native + Expo + i18next

**为什么选**
- 一套代码 iOS/Android，单人维护成本最低
- Expo 管理原生构建（EAS），免去原生模块调试
- i18next 是 RN 生态成熟方案

**为什么不选**
- ❌ Flutter：跨端一致性好但与后台 TS 栈类型共享链路复杂
- ❌ 原生双端开发：单人不可能完成

---

## 六、实时通信

### 选型：Socket.IO（主）+ HTTP 轮询（兜底）

**为什么双轨（v0.3 决策 G）**
- WS 主通道：骑手 5s 推位置 → 服务端 → 客户端实时显示
- HTTP 兜底：`GET /orders/:id/tracking` 30s 轮询，WS 断线降级
- 客户端启动同时开 WS + 定时器，WS 收到消息重置定时器

**为什么不选**
- ❌ 纯 WS：弱网（东帝汶 4G）断线无降级，体验差
- ❌ 纯轮询：每 10s 一次，骑手位置滞后期望高，流量浪费
- ❌ MQTT：移动端接入复杂，运营经验少

### WebSocket 库：Socket.IO（而非裸 ws）

- 自动重连 + 房间订阅 + 兼容性处理
- 服务端 NestJS Gateway 一等公民支持

---

## 七、支付（v0.3 决策 D：5 枚举全预留）

### 策略模式：`PaymentStrategy` 抽象

| 方式 | MVP 实现 | 真实接入条件 |
|---|---|---|
| **COD**（货到付款） | ✅ 真实（骑手送达收款） | 无需主体 |
| **BANK_TRANSFER**（本地银行转账） | ✅ 真实（凭证上传 + 人工对账） | 无需主体 |
| **WECHAT**（微信支付） | 🟡 Mock（返回 `MOCK_<uuid>`） | 挂靠国内个体户后 |
| **PAYPAL** | 🟡 Stub（返回 mock URL） | Stripe Atlas 后接 Business |
| **STRIPE** | 🟡 Stub（返回 mock client_secret） | Atlas LLC 后接 |

**为什么不选**
- ❌ 支付宝：东帝汶用户渗透率低，MVP 跳过
- ❌ Apple/Google Pay：依赖海外主体 + 设备占比低
- ❌ 加密货币：合规风险大

### 接口设计

```typescript
interface PaymentStrategy {
  createPayment(orderId: string, amount: number): Promise<PaymentIntent>;
  queryPayment(transactionId: string): Promise<PaymentStatus>;
  refund(transactionId: string, amount: number): Promise<RefundResult>;
}
```

切换支付方式只改 `.env` 的 `PAYMENT_STRATEGY`，不改代码。

---

## 八、OTP / 认证（v0.3 + SMS 反转）

### 策略模式：`OtpStrategy` 抽象，4 策略

| 策略 | MVP 实现 | 用途 |
|---|---|---|
| **PasswordStrategy** | ✅ 真实（bcrypt 哈希） | 主登录 |
| **SmsStrategy** | 🟡 Stub（固定 `123456`，标 `[SMS_STUB]`） | 手机验证 |
| **EmailStrategy** | ✅ 真实（MailHog dev / SendGrid prod） | 找回密码 |
| **WhatsAppStrategy** | 🟡 Stub（固定 `123456`） | 预留，W6 申请 Business API |

**SMS 反转决策（2026-06-19）**：v0.2 曾决定"完全不接 SMS"，v0.3 反转为接，测试 stub，W6 切东帝汶本地 Timor Telecom/Telkomcel（倾向本地 C 路线，国际 Twilio/Vonage 贵价兜底）。

### JWT 设计（v0.3 决策 C：删 clientType）

```typescript
interface JwtPayload {
  sub: string;        // userId
  role: 'super_admin' | 'customer' | 'rider' | 'warehouse_staff' | 'customer_service';
  deviceType: 'client_app' | 'rider_app' | 'admin_web';
  iat: number;
  exp: number;
  jti: string;        // logout 黑名单定位
}
```

### Token TTL（v0.3 决策 E：分端）

| 端 | accessToken | refreshToken |
|---|---|---|
| client_app | 30d | 60d |
| rider_app | 12h | 60d |
| admin_web | 2h | 60d |

### logout（v0.3 决策 F：必传 refreshToken）

- 服务端加 Redis 黑名单 `blacklist:{jti}`
- accessToken 自然过期（不能服务端 revoke）

---

## 九、i18n

### 选型：next-intl（Web）+ i18next（App）

**支持语言**：`en / id / zh / pt` 4 种 + Tetum 留接口空翻译

**为什么不选**
- ❌ 全端 i18next：Web 端 SSR/Server Component 支持不如 next-intl
- ❌ 全端 next-intl：RN 端兼容性差

### 多语言字段存储（v0.3 决策 B）

- 统一 `Record<string, string>` JSON
- 例：`{ "en": "Milk", "zh": "牛奶", "id": "Susu", "pt": "Leite" }`
- 查询按 `Accept-Language` 取值，fallback 链 `lang → en → ""`

---

## 十、CI/CD 与容器

### CI/CD：GitHub Actions

- PR 触发：lint + typecheck + test + contract 校验 + pnpm audit
- merge to main：build → ssh staging → docker compose pull → up → health check
- 失败自动回滚（保留上一版本镜像）

### 容器：Docker Compose（单机）

**为什么 Compose 而非 K8s**
- MVP 流量级（DAU 5000）单机够用
- K8s 学习/运维成本远超收益
- 后期切 K8s 时，Dockerfile 直接复用

**Compose 服务**：
- `postgis/postgis:16-3.4`（数据库）
- `redis:7-alpine`（缓存/MQ）
- `minio/minio`（对象存储 dev）
- `mailhog/mailhog`（邮件 dev）
- `backup-cron`（pg_dump 定时，每小时）

---

## 十一、监控与日志

### 选型：Sentry + pino

- Sentry：错误追踪 + trace_id 贯穿
- pino：结构化 JSON 日志，dev debug / prod info

**为什么不选**
- ❌ Prometheus + Grafana：MVP 不需要 metrics 看板，Sentry 性能监控够用
- ❌ Winston：性能不如 pino，结构化字段弱

---

## 十二、部署区域

### 选型：印尼雅加达（AWS ap-southeast-3 / Aliyun 印尼节点）

**为什么**
- 到东帝汶延迟 < 50ms（比新加坡更近）
- 合规简单，无数据本地化强制要求
- 印尼节点成本低于新加坡

**为什么不选**
- ❌ 东帝汶本地服务器：MVP 阶段合规未明，且本地 IDC 不成熟
- ❌ 新加坡：延迟比雅加达高 30ms
- ❌ 香港/中国大陆：到东帝汶延迟 100ms+

---

## 十三、未决项（W6 决断）

1. SMS 服务商最终选择（本地 C vs 国际）
2. 微信支付真实商户号（挂靠国内个体户 vs 永久 mock）
3. PayPal Business / Stripe Atlas 主体
4. 法律主体（国内个体户 / 东帝汶合伙 / Stripe Atlas）
5. 正式域名（W7 上线前定）

---

## 十四、ADR 修订记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-20 | v1.0 | 初版（D1-T4 落档），整合 v0.2 + v0.3 + CLAUDE.md 决策 |
