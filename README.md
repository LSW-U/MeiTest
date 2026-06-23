# MeiMart

> 东帝汶超市电商 MVP（客户端 App + 骑手 App + 后台 Web）
> 单一市场：Asia/Dili UTC+9, USD

## 状态

**W1 共享前置层 ✅ 完成（D1-D7 全部 36 任务），可进 W2**（2026-06-21 验收通过）

- ✅ Monorepo + pnpm workspace + Turborepo
- ✅ 契约（zod + OpenAPI + TS 类型自动生成 + CI 一致性强校验）
- ✅ PostgreSQL 16 + PostGIS 3.4 + GIST 索引（init migration 已 apply）
- ✅ 29 张基线表（v0.3 决策扩展）+ 种子数据可登录
- ✅ shared-db / shared-cache / shared-infra 封装（5 支付 + 4 OTP + Map + OSS）
- ✅ 三端登录页 UI + i18n 9 模块 × 5 语言（250 key/lang）
- ✅ NestJS + 全局拦截器 + Swagger UI `/docs` + pino 日志 + Sentry
- ✅ JWT（分端 TTL + Redis 黑名单）+ RBAC + device_type + audit 三道闸门
- ✅ docker compose 一键起本地全栈（pg+postgis / redis / minio / mailhog / backup cron）
- ✅ GitHub Actions CI（typecheck + test + contract + security + build）+ Deploy staging
- ✅ **Socket.IO WS 通道打通**（骑手位置推送链路，`/realtime` namespace + JWT handshake 鉴权）
- ⚠️ 遗留：pnpm audit 18 high（next.js 14 升 15.5.16+ W2 处理）；staging 服务器待申请

完整验收见 Obsidian `_inbox/04-后端记录/MeiMart-W1验收报告-20260621.md`。
技术栈决策见 `CLAUDE.md` + Obsidian `04-后端记录/MeiMart-ADR-技术栈选型-20260617.md`。

## 环境要求

| 工具 | 最低版本 | 验证命令 |
|---|---|---|
| Node.js | 20+（开发机用 22 LTS） | `node -v` |
| pnpm | 11+ | `pnpm -v` |
| Docker | 25+（含 Compose v2） | `docker -v` |
| Git | 2.40+ | `git -v` |

### 启用 pnpm（首次）

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

> **注意（Mac hermes node）**：corepack 默认不软链到 PATH，需手动 `ln -sf $(which node | xargs dirname)/corepack ~/.local/bin/corepack`

## 一键启动（新机器 ≤ 30 分钟）

```bash
# 1. 拉代码
cd /Users/linsuwei/code/Work/MeiMart

# 2. 装依赖（含所有 workspace 包）
pnpm install

# 3. 起本地基础设施（postgres + redis + minio + mailhog + backup）
docker compose up -d
# 等 30 秒让 healthcheck 通过
docker compose ps   # postgres/redis/minio 都应 healthy

# 4. 跑数据库迁移（应用 init migration，含 GIST 索引）
pnpm --filter @meimart/api exec prisma migrate deploy

# 5. 种子数据（super_admin + shop + 3 warehouses + 10 products + 20 SKUs + 60 stock）
pnpm --filter @meimart/api db:seed

# 6. 全栈启动（4 个 app 并行）
pnpm dev
# - apps/api → http://localhost:3000（NestJS + Swagger /docs + mock 登录）
# - apps/admin-web → http://localhost:3001（Next.js；端口见 admin-web 配置）
# - apps/client-app → 用 Expo Go 扫 QR
# - apps/rider-app → 用 Expo Go 扫 QR
```

## 登录测试账号

| 字段 | 值 |
|---|---|
| Phone | `+670999999999` |
| Email | `admin@meimart.dev` |
| Password | `admin12345` |
| Role | `SUPER_ADMIN` |

### mock 登录端点（dev/staging 用，prod 自动隐藏）

```bash
# 三端 mock 登录（跳过密码校验，签发完整 token pair）
curl -X POST http://localhost:3000/api/v1/common/auth/mock-login \
  -H "Content-Type: application/json" \
  -d '{"role":"super_admin","deviceType":"admin_web"}'
# 返回 { user, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }
```

## 常用命令

```bash
# 全栈 typecheck
pnpm typecheck

# 单测 + 覆盖率（shared-utils）
pnpm --filter @meimart/shared-utils test:coverage

# 改契约后必跑（zod → OpenAPI → TS 类型）
pnpm --filter @meimart/api-contract gen:openapi
pnpm --filter @meimart/shared-types gen:types

# 数据库
pnpm --filter @meimart/api db:migrate      # 创建并应用新 migration
pnpm --filter @meimart/api db:migrate:create  # 只创建 SQL 不 apply（保险 2 用）
pnpm --filter @meimart/api db:seed         # 重跑种子（幂等）
pnpm --filter @meimart/api db:studio       # Prisma Studio 数据浏览 UI
pnpm --filter @meimart/api db:reset        # 重置数据库（dev 用，会清数据）

# docker
docker compose up -d          # 起本地全栈
docker compose down           # 停服务（保留数据卷）
docker compose down -v        # 停服务 + 删数据卷（完全重置）
docker compose logs -f postgres  # 看 postgres 日志

# infra 验证（手动）
docker exec meimart-pg psql -U postgres -d meimart -c "SELECT PostGIS_Version();"
docker exec meimart-redis redis-cli ping
curl http://localhost:9000/minio/health/live    # MinIO
curl http://localhost:8025                       # MailHog Web UI

# 备份恢复演练
docker exec meimart-backup sh -c 'pg_dump -Fc meimart > /backups/manual_$(date +%Y%m%d%H%M).dump'
docker exec meimart-backup dropdb --if-exists meimart_restore
docker exec meimart-backup createdb meimart_restore
docker exec meimart-backup pg_restore --no-owner -d meimart_restore /backups/manual_XXX.dump
```

## 服务端口

| 服务 | 端口 | 用途 |
|---|---|---|
| postgres | 5432 | 数据库（DATABASE_URL 见 `.env`） |
| redis | 6379 | 缓存 / 限流 / JWT 黑名单 |
| minio API | 9000 | 对象存储（商品图 / 头像 / 凭证） |
| minio Console | 9001 | MinIO Web UI（账号 minioadmin / minioadmin） |
| mailhog SMTP | 1025 | dev 邮件发送（apps/api SMTP_PORT=1025） |
| mailhog Web | 8025 | 看捕获的邮件 |
| admin-web | 3000 | Next.js 后台 |
| client-app | 8081 | Expo Metro（扫码用 Expo Go） |
| rider-app | 8082 | Expo Metro（避开 client-app 端口） |

## 仓库结构

```
MeiMart/
├── apps/
│   ├── api/              # NestJS（D4-T1 装详细，当前含 schema/seed/shared/infrastructure）
│   ├── admin-web/        # Next.js 14 + next-intl（后台 Web）
│   ├── client-app/       # Expo + RN + i18next（客户端 App）
│   └── rider-app/        # Expo + RN + i18next（骑手 App）
├── packages/
│   ├── api-contract/     # zod schema 源 + OpenAPI + Mock Server
│   ├── shared-types/     # OpenAPI → TS 类型自动生成
│   ├── shared-utils/     # 工具 + 单测（100% 覆盖）
│   ├── shared-locales/   # i18n 翻译（D5-T1 完善）
│   └── ui-kit/           # shadcn 二次封装（W2+）
├── docker-compose.yml    # postgres + redis + minio + mailhog + backup
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── CLAUDE.md             # 项目根指令（所有规则约束）
```

## 常见问题

### `prisma migrate dev` 报"non-interactive"

TTY 检测失败。在 shell 里用：

```bash
yes | script -q /dev/null pnpm --filter @meimart/api exec prisma migrate dev
```

### prisma migrate 后多出 `yyyy...` 命名的 drift migration

prisma 视手补的 GIST 索引为 drift（schema.prisma 无法表达），会生成 DROP migration。修复：

```bash
rm -rf apps/api/prisma/migrations/<timestamp>_yyyy*
docker exec meimart-pg psql -U postgres -d meimart -c \
  'CREATE INDEX IF NOT EXISTS idx_warehouses_coverage_gist ON "warehouses" USING GIST ("coverageArea");
   CREATE INDEX IF NOT EXISTS idx_warehouses_center_gist ON "warehouses" USING GIST ("centerPoint");'
docker exec meimart-pg psql -U postgres -d meimart -c \
  "DELETE FROM _prisma_migrations WHERE migration_name LIKE '<timestamp>_yyyy%';"
```

### pnpm 装包时报 `[ERR_PNPM_IGNORED_BUILDS]`

pnpm 11 默认拦截 native 模块的 build script。在 `pnpm-workspace.yaml` 的 `allowBuilds` 加 `包名: true`。

### admin-web 4 语言不生效

确认 `apps/admin-web/messages/{en,zh,id,pt}.json` 都有内容，且 cookie `locale` 值是这 4 个之一（否则 fallback en）。

### Docker 端口被占用

`lsof -i :5432` 找占用进程，或改 `docker-compose.yml` 端口映射。

### `corepack: command not found`

你的 node 通过非官方途径（如 hermes）安装。corepack 没软链到 PATH：

```bash
ln -sf $(dirname $(readlink -f $(which node)))/corepack ~/.local/bin/corepack
```

## 外部账号准备（W6 之前都跳过）

| 服务 | 当前状态 | 真实接入条件 |
|---|---|---|
| Google Maps | 🟡 stub（Dili 中心假数据） | W6 申请个人 key |
| SMS | 🟡 stub（固定 123456） | W6 切东帝汶本地 Timor Telecom/Telkomcel |
| 微信支付 | 🟡 mock | 国内个体户挂靠后 |
| PayPal | 🟡 stub | Stripe Atlas 后接 Business |
| Stripe | 🟡 stub | Atlas LLC 后接真 |
| 邮件 | ✅ MailHog dev / SendGrid prod | SendGrid 个人账号够 MVP |

完整决策矩阵见 `CLAUDE.md` §外部服务。

## 升级 / 重置

```bash
# 重置数据库（删除所有数据 + 重建 schema + 重跑 seed）
docker compose down -v
docker compose up -d
sleep 30
pnpm --filter @meimart/api exec prisma migrate deploy
pnpm --filter @meimart/api db:seed

# 完全从零开始
git clean -fdx
pnpm install
docker compose up -d
```

## 文档索引

- `CLAUDE.md` — 项目根指令（必读）
- Obsidian `04-后端记录/`：
  - `MeiMart-ADR-技术栈选型-20260617.md` — ADR
  - `MeiMart-W1共享前置层-AI执行版-20260617.md` — W1 任务清单
  - `API契约文档-v0.2.md` + `API契约文档-v0.3.md` — 契约（冲突以 v0.3 为准）
  - `claude后端记录/` — 各 D 任务交互记录
