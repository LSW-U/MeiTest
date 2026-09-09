# MeiMart 后端公共能力速查

> 核实基线：2026-09-09 @ `main 8b319f7`（公共common模块 · 批1 产出）
> 用途：做事 CC / 新会话不再"口口相传"翻代码，公共能力一页可查。所有条目均经 grep 举证（路径 + 行号）。
> 维护约定：后续模块批次顺带核对更新（记账不立项）；新增公共能力时在对应章节补一行。

---

## 一、6 类核心能力（强制章节）

全局注册方式：`apps/api/src/app.module.ts`（APP_GUARD × 5 / APP_INTERCEPTOR / APP_FILTER / Middleware），见 `app.module.ts:97-141`。

### 1. Guards（5 个，全局守卫链）

| 文件 | 用途 | 引用入口（grep 举证） |
|---|---|---|
| `apps/api/src/shared/guards/jwt-auth.guard.ts` | JWT 鉴权，读 `@Public()` 放开公开路由 | `app.module.ts:48` import，`app.module.ts:104` APP_GUARD（第 1 道） |
| `apps/api/src/shared/guards/device-type.guard.ts` | 校验 JWT `deviceType` 与路由预期匹配（审计用，`/common/*` 前缀自动放行） | `app.module.ts:50`，`app.module.ts:105`（第 2 道） |
| `apps/api/src/shared/guards/roles.guard.ts` | RBAC，读 `@Roles()` 装饰器比对 `UserRole` | `app.module.ts:49`，`app.module.ts:106`（第 3 道） |
| `apps/api/src/shared/guards/rate-limit.guard.ts` | 限流闸门，读 `@RateLimit()` 装饰器（无装饰器跳过），复用 Redis 滑动窗口 | `app.module.ts:51`，`app.module.ts:107`（第 4 道）；内部引 `cache/rate-limit.ts:20`、`decorators/rate-limit.decorator.ts:19` |
| `apps/api/src/shared/guards/csrf.guard.ts` | CSRF 校验（写方法 + cookie 场景），抛 ForbiddenException 经统一异常过滤器 | `app.module.ts:8`，`app.module.ts:109`（第 5 道）；迁移注释见 `app.module.ts:142` |

守卫顺序（`app.module.ts:97` 注释）：Jwt → DeviceType → Roles → RateLimit（+ Csrf）。

### 2. Pipes

| 文件 | 用途 | 引用入口 |
|---|---|---|
| `apps/api/src/shared/pipes/zod-validation.pipe.ts` | zod schema 校验管道（契约 zod 单一来源的执行端） | 各 controller `@Body/@Query/@Param(new ZodValidationPipe(Schema))`；消费 controller ≥22 个，例：`modules/order/order.controller.ts:34`、`modules/catalog/catalog.controller.ts`（11 处）、`modules/common/geo/geo.controller.ts:69` |

### 3. Decorators（5 个）

| 文件 | 用途 | 引用入口 |
|---|---|---|
| `apps/api/src/shared/decorators/public.decorator.ts` | `@Public()` 标记公开路由（JwtAuthGuard 读取） | `guards/jwt-auth.guard.ts` + 各公开 controller，例：`modules/auth/auth.controller.ts`、`modules/home/home.controller.ts`、`modules/common/geo/geo.controller.ts:66` |
| `apps/api/src/shared/decorators/roles.decorator.ts` | `@Roles(...)` RBAC 标记 | 各 admin controller，例：`modules/order/admin-order.controller.ts`、`modules/rate/rate.controller.ts` |
| `apps/api/src/shared/decorators/audit.decorator.ts` | `@Audit({ resource, resourceIdParam? })` 声明审计资源，配合 AuditInterceptor 写 AuditLog（含 perspective/deviceType/before/after） | `interceptors/audit.interceptor.ts` + 写操作 controller，例：`modules/promotion/promotion.controller.ts:96-133` |
| `apps/api/src/shared/decorators/rate-limit.decorator.ts` | `@RateLimit()` 声明限流配置，RateLimitGuard 读取 | `guards/rate-limit.guard.ts:19`；使用例：`modules/auth/auth.controller.ts`、`modules/auth/unified-auth.controller.ts`、`modules/feedback/feedback.controller.ts` |
| `apps/api/src/shared/decorators/action.decorator.ts` | `@Action('auth.login')` 标记业务 action，LoggingInterceptor 读（无则 fallback Controller.handler 推断） | `interceptors/logging.interceptor.ts:22,48`（唯一消费方） |

### 4. Filters

| 文件 | 用途 | 引用入口 |
|---|---|---|
| `apps/api/src/shared/filters/all-exceptions.filter.ts` | 全局异常 → 统一结构 `{ code, message, traceId, i18nKey }`（错误码 E-* 前端查 i18n 显示） | `app.module.ts:3,129`（APP_FILTER）；traceId 贯穿依赖 TraceIdMiddleware 先注入，`app.module.ts:137-141` |

### 5. Interceptors（3 个，全局）

| 文件 | 用途 | 引用入口 |
|---|---|---|
| `apps/api/src/shared/interceptors/audit.interceptor.ts` | 配合 `@Audit()` 拦截写操作写 AuditLog | `app.module.ts:5,117-120`（APP_INTERCEPTOR） |
| `apps/api/src/shared/interceptors/logging.interceptor.ts` | 结构化请求日志，action 取自 `@Action()` | `app.module.ts:4,112-115` |
| `apps/api/src/shared/interceptors/trace-id.interceptor.ts` | traceId 注入 ALS（**兼容保留**：主链路已改 TraceIdMiddleware，Guard 抛错场景 Interceptor 来不及跑） | `middleware/trace-id.middleware.ts:5`、`logger/trace-context.ts:6` 注释说明历史 |

### 6. Middleware

| 文件 | 用途 | 引用入口 |
|---|---|---|
| `apps/api/src/shared/middleware/trace-id.middleware.ts` | 所有路由最早期注入 ALS traceId（X-Trace-Id 贯穿） | `app.module.ts:7,141` `consumer.apply(TraceIdMiddleware).forRoutes('*')` |

---

## 二、错误码与多语言约定（强制章节）

### E-* 五语言体系

- **错误码格式**：`E-{MODULE}-{NNN}`（如 `E-AUTH-001`、`E-ORDER-042`、`E-COMMON-004`）。新模块预留 001-099 段，不撞既有模块段位。
- **翻译文件**：`packages/shared-locales/<lang>/errors.json`，五语言 `en / id / zh / pt / tet`。
- **规模基线（2026-09-09 Node 精确扫描）**：155 个 key 全部为 `E-*` 格式；五语言 keyset 完全 parity（无缺 key / 无多 key）；唯一硬伤 tet 2 条空串（`E-RATE-001`、`E-RATE-002`）；tet 与 en 完全相同的副本 101/155（65%），id/pt 各 4 条、zh 0 条；插值占位符 `{x}` mismatch = 0。
- **其它 namespace**：每语言 13 个 JSON（auth/cart/catalog/common/errors/im/order/payment/platform/settle/shop/user/warehouse），bundle 文件名即 namespace。

### 加错误码的步骤

1. 后端抛错处用错误码（AllExceptionsFilter 统一包装为 `{ code, message, traceId, i18nKey }`）；
2. 在 `packages/shared-locales/en/errors.json` 加 key，**五语言同步**（zh/pt/id/tet 缺一不可，tet 没有翻译至少不要留空串——可先 en 副本）；
3. 跑门禁 `pnpm --filter @meimart/shared-locales check:usage`（脚本 `packages/shared-locales/scripts/check-i18n-usage.mjs`，package.json:18）确认 exit 0；
4. 前端 fetch wrapper 按 `Accept-Language` 查 key 显示，找不到 key 会显示 MISSING_MESSAGE——所以五语言同步是硬要求。

### 多语言字段（DB 层）

需要多语言的 DB 字段（name/description/title/unit 等）统一存 JSON：`Record<string, string>`，支持 `en/id/zh/pt`，tet 留 key 空串，查询按 `Accept-Language` fallback：`lang → en → 空字符串`。

---

## 三、限流（强制章节）

| 层 | 文件 | 机制 | 举证 |
|---|---|---|---|
| Redis 滑动窗口 | `apps/api/src/shared/cache/rate-limit.ts` | ZSET + Lua 滑动窗口（W7-ext-H v1.2 修复：原固定窗口注释误标） | `guards/rate-limit.guard.ts:20` 复用 |
| 装饰器驱动限流 | `guards/rate-limit.guard.ts` + `decorators/rate-limit.decorator.ts` | `@RateLimit()` 声明式，超限 429 + Retry-After + `{ code, message, retryAfter }` | `app.module.ts:107` 全局注册 |
| geo 专用内存限流 | `modules/common/geo/geo.controller.ts:26-50` | 每 IP 1 req/s + 10 req/min（内存 RateLimiter 类，单实例够用；多实例需切 Redis/@nestjs/throttler），超限 429 `E-COMMON-004` | `geo.controller.ts:74-84`；W7-fix P1-3，对齐 Nominatim ≤1 req/s 政策 |

---

## 四、扩展目录（全盘点，逐目录一行带路径）

基线：`apps/api/src/shared/` 共 15 组目录（ls 实测）。

| 目录 | 内容 | 代表消费方 |
|---|---|---|
| `shared/auth/` | `assert-jwt-secret.ts`（启动期 JWT secret 校验）、`cookie-helper.ts` | `main.ts`、`modules/auth/*` |
| `shared/cache/` | `redis.ts`（ioredis 单例 lazy）、`rate-limit.ts`（ZSET+Lua 滑窗）、`jwt-blacklist.ts`（logout 即失效）、`refresh-session.ts`（refresh token family）、`registration-ticket.ts`（注册票据）、`session.ts`（可选会话缓存）、`index.ts` | auth 模块、rate-limit.guard、全仓 Redis 消费入口 |
| `shared/db/` | `prisma.ts`（PrismaClient 单例）、`postgis-helpers.ts`（ST_Within/ST_Distance 仓库匹配，含 `findWarehouseByPoint` 等 7 个导出）、`category-top3.ts`、`reconciliation-ledger.ts`、`sales-count.ts`、`transaction.ts`（`withTransaction` 事务 helper）、`index.ts` | `modules/inventory/inventory.service.ts`（matchWarehouse）、`modules/rider/admin-deposit.service.ts:27`（withTransaction）、promotion/reconciliation 等 |
| `shared/datetime/` | `index.ts` 时间工具 | `modules/rate/rate.service.ts`、`modules/settle/*` |
| `shared/idempotency/` | `idempotency.module.ts` + `idempotency.service.ts` + `index.ts`（Idempotency-Key 幂等） | `app.module.ts`、`modules/order/order.controller.ts` |
| `shared/logger/` | `logger.ts`（pino 结构化）、`trace-context.ts`（ALS trace 上下文） | `main.ts`、`guards/jwt-auth.guard.ts`、`infrastructure/notify/sms.strategy.ts` |
| `shared/monitoring/` | `sentry.ts`（Sentry 接入） | `main.ts` |
| `shared/queue/` | `queue.module.ts` + `queue.constants.ts` + `index.ts`（BullMQ 队列基建） | `app.module.ts`、`modules/promotion/coupon-expire.{scheduler,processor}.ts` |
| `shared/storage/` | `storage.service.ts`（MinIO/OSS 封装）、`storage.module.ts`、`public-url.interceptor.ts`（响应 URL 转公开地址） | `app.module.ts:124`、`modules/feedback/*`、`modules/refund/*` |

---

## 五、公共端点归口（决策记录 O1，C4 成文）

**决策**：health / auth / platform / legal 各自保持独立模块，**不并入 common**。理由：各模块消费方清晰、归属单一，归口调整属重构且违反"不搬家"红线（方案 v2 §4）；common 模块仅聚合 geo + legal 之外的公共只读端点场景不成立。

| 归属 | 端点前缀 | 说明 | 举证 |
|---|---|---|---|
| `modules/common/` | `api/v1/common/geo/*` | geo geocoding（@Public + 内存限流）；`/common/*` 前缀自动放行 DeviceTypeGuard | `common.module.ts:12-17`（imports GeoModule + LegalModule）、`geo/geo.controller.ts:61` |
| `modules/legal/` | `GET /api/v1/common/legal/:docType` | TERMS/PRIVACY/LICENSE 正文下发，@Public，未 seed → `E-LEGAL-001`；**保持独立**（v2 核实 common.module 同时挂了 legal） | `common.module.ts:16`、legal.controller.ts |
| `modules/health/` | `GET /health`（无 /api/v1 前缀） | 独立健康检查模块，**不复用 common 前缀**（infra 探活与业务公共端点语义不同） | `health/health.controller.ts:36` `@Controller('health')`；2026-09-09 实测 200 |
| `modules/auth/` | `api/v1/common/auth/*`（3 个 controller 同前缀） | auth / unified-auth / mock-login；路径在 common 命名空间下但**模块独立**，鉴权/OTP 策略自成体系 | `auth.controller.ts:44`、`unified-auth.controller.ts:37`、`mock-login.controller.ts:45` |
| `modules/platform/` | `api/v1/common/support`（support-config）+ `api/v1/admin/platform/*`（dashboard/system-configs/audit-logs） | 客服配置走 common 命名空间，管理端走 admin 前缀；**模块独立** | `platform/support-config.controller.ts:28`、`dashboard.controller.ts:16`、`system-config.controller.ts:18`、`audit.controller.ts:27` |

> 注意："挂 `api/v1/common/*` 路径前缀" ≠ "归 common 模块"。判定归属以 `@Module` 所在目录为准，路径前缀只是对外 URL 组织。
