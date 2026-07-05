# MeiMart 运维 Runbook

> **版本**：v1.0
> **最后更新**：2026-07-05
> **适用范围**：MeiMart MVP 上线后日常运维 + 故障处理

---

## 一、服务清单

### 1.1 容器（docker compose）

| 容器名 | 镜像 | 端口 | 用途 |
|---|---|---|---|
| `meimart-pg` | postgis/postgis:16-3.4 | 5432 | 主数据库（PostgreSQL 16 + PostGIS 3.4） |
| `meimart-redis` | redis:7-alpine | 6379 | 缓存 + BullMQ 队列 |
| `meimart-minio` | minio/minio:latest | 9000 / 9001 | 对象存储（图片）+ 控制台 |
| `meimart-mailhog` | mailhog/mailhog:latest | 1025 / 8025 | dev 邮件捕获（prod 切 SendGrid） |

### 1.2 应用进程

| 进程 | 启动命令 | 端口 | 健康检查 |
|---|---|---|---|
| API | `pnpm --filter @meimart/api start:dev` | 3000 | `GET /api/v1/common/health` |
| admin-web | `pnpm --filter @meimart/admin-web start` | 3001 | `GET /` HTTP 200 |

### 1.3 外部依赖

| 服务 | 用途 | 重启策略 |
|---|---|---|
| Sentry | 错误监控 + traceId | SDK 初始化失败不阻断启动 |
| Nominatim | 地址 geocoding（OpenStreetMap） | 失败兜底 Dili 城市中心坐标 |
| Google Maps | 客户端 App 地图 SDK | 客户端独立处理 |

---

## 二、日常运维操作

### 2.1 启动 / 停止

```bash
cd /Users/linsuwei/code/Work/MeiMart

# 启动基础设施
docker compose up -d postgres redis minio mailhog

# 启动应用（dev）
pnpm dev   # 4 个 app 同时起（API + admin-web + 两个 client app 占位）

# 单独启动
pnpm --filter @meimart/api start:dev
pnpm --filter @meimart/admin-web dev

# 停止基础设施
docker compose down
```

### 2.2 数据库备份 + 恢复

**手动备份**：

```bash
./scripts/pg-backup.sh
# 输出：/opt/meimart/backups/meimart-YYYYMMDD-HHMM.sql.gz
```

**恢复演练**（生产每月跑一次）：

```bash
./scripts/pg-restore-test.sh
# 从最新备份恢复到测试库，验证完整性
```

**定时备份**（生产 cron）：

```
0 2 * * * /opt/meimart/scripts/pg-backup.sh >> /var/log/meimart-backup.log 2>&1
```

保留策略：最近 7 天（`KEEP_DAYS=7`）。

### 2.3 日志查看

```bash
# API 日志（pino + Sentry）
docker logs -f meimart-api 2>&1 | jq .

# 按级别过滤
docker logs meimart-api 2>&1 | jq 'select(.level >= 40)'  # warn+

# 按 traceId 串联
docker logs meimart-api 2>&1 | jq "select(.traceId == \"<traceId>\")"

# Sentry 实时错误流
# 浏览器打开 Sentry dashboard → Issues → Realtime
```

### 2.4 Redis 运维

```bash
# 内存占用
docker exec meimart-redis redis-cli INFO memory | grep used_memory_human

# 队列状态（BullMQ）
docker exec meimart-redis redis-cli KEYS 'bull:*'
docker exec meimart-redis redis-cli LLEN 'bull:order-timeout-queue:wait'

# 强制清空某队列（小心！仅开发环境）
docker exec meimart-redis redis-cli DEL 'bull:order-timeout-queue:wait'
```

### 2.5 MinIO 运维

```bash
# bucket 列表
docker exec meimart-minio mc ls local/

# bucket 策略（dev 应为 public-read，prod 应为 private）
docker exec meimart-minio mc anonymous set public local/meimart  # dev
docker exec meimart-minio mc anonymous set none local/meimart     # prod

# 看上传的图片
docker exec meimart-minio mc ls local/meimart/products/ --recursive
```

---

## 三、常见故障处理

### 3.1 API 启动失败

**症状**：`pnpm --filter @meimart/api start:dev` 报错退出

**排查步骤**：

1. **看错误码**：
   - `E-AUTH-*` → JWT secret 或 env 没配
   - `E-DATABASE-*` → 数据库连不上
   - `E-STORAGE-*` → MinIO env 不全

2. **检查 env**：
   ```bash
   cat apps/api/.env | grep -E 'JWT_SECRET|DATABASE_URL|OSS_|REDIS_'
   ```

3. **检查容器**：
   ```bash
   docker compose ps
   # 全部应该 Up (healthy)
   ```

4. **检查 Prisma 客户端**：
   ```bash
   pnpm --filter @meimart/api prisma migrate status
   ```

### 3.2 数据库连接池耗尽

**症状**：API 报 `Timed out fetching a new connection from the connection pool`

**排查**：

```bash
# 看连接数
docker exec meimart-pg psql -U postgres -d meimart -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# 看长事务
docker exec meimart-pg psql -U postgres -d meimart -c \
  "SELECT pid, age(clock_timestamp(), query_start), query FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;"
```

**处理**：

- 长事务 kill：`SELECT pg_terminate_backend(<pid>);`
- 调整 `DATABASE_CONNECTION_LIMIT`（默认 10，prod 推荐 20-30）

### 3.3 Redis 宕机

**症状**：API 报 `Redis connection refused`

**影响**：
- 缓存层失败 → 查询走 DB（性能下降 5-10 倍）
- BullMQ 队列丢失 → 订单超时取消不触发
- cart 持久化失败

**处理**：

```bash
# 重启 Redis
docker restart meimart-redis

# 等待健康检查
docker compose ps redis

# 验证
docker exec meimart-redis redis-cli PING
# 期望：PONG
```

**重启后**：
- BullMQ 自动恢复未完成的 job（依赖 Redis 持久化）
- 如果 Redis 用了 RDB/AOF，未持久化的 job 会丢失

### 3.4 MinIO bucket 不存在 / 拒绝访问

**症状**：上传图片报 `The specified bucket does not exist` 或 `Access Denied`

**排查**：

```bash
# bucket 是否存在
docker exec meimart-minio mc ls local/

# 看权限策略
docker exec meimart-minio mc anonymous show local/meimart
```

**处理**：

```bash
# bucket 不存在 → StorageService onModuleInit 会自动创建
# 但需要确认 env OSS_BUCKET=meimart 与实际一致

# 手动创建
docker exec meimart-minio mc mb local/meimart

# dev 设 public-read
docker exec meimart-minio mc anonymous set public local/meimart
```

### 3.5 订单状态卡死

**症状**：订单状态停在某个状态不动（如 PENDING_CONFIRM 超过 1 小时）

**排查**：

```sql
-- 看订单事件历史
SELECT * FROM "OrderEvent" WHERE "orderId" = '<order-id>' ORDER BY "createdAt";
```

**处理**：

| 卡死状态 | 应转状态 | 处理 |
|---|---|---|
| PENDING_PAYMENT > 30 min | CANCELLED | 等待 BullMQ 自动取消（order-timeout-queue） |
| PENDING_CONFIRM > 24h | 人工介入 | admin 调 PATCH /admin/orders/:id/status |
| CONFIRMED > 2h（未派单） | PICKED | 检查 dispatch task 是否生成 |
| ASSIGNED > 30 min（骑手未确认） | 重新派单 | admin 调 dispatch reset 端点（待开发） |
| PICKED_UP > 2h | DELIVERED | 联系骑手，必要时人工标送达 |

### 3.6 Sentry 告警阈值

**告警规则**（在 Sentry dashboard 配置）：

| 规则 | 阈值 | 通知渠道 |
|---|---|---|
| Error rate spike | > 5% in 5 min | Email + Slack |
| New error | 任何新错误 | Email |
| Performance regression | p99 > 1s in 10 min | Email |
| Cron job failed | 备份脚本失败 | Email + SMS |

---

## 四、上线 checklist

### 4.1 上线前必查

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm --filter @meimart/api test` 全绿（≥ 400 tests）
- [ ] `pnpm --filter @meimart/admin-web lint` 全绿
- [ ] `pnpm --filter @meimart/api test:e2e` 全绿（19 tests）
- [ ] openapi.yaml 与代码一致（`grep -c "^  /api/v1" packages/api-contract/openapi.yaml`）
- [ ] Migration 状态干净（`prisma migrate status`）
- [ ] Sentry DSN 配置正确
- [ ] .env.production 已配置所有 OSS_* / DATABASE_URL / REDIS_URL / JWT_SECRET

### 4.2 部署流程

```bash
# 1. 拉最新代码
git pull origin main

# 2. 装依赖
pnpm install --frozen-lockfile

# 3. 跑 migration
pnpm --filter @meimart/api prisma migrate deploy

# 4. 构建
pnpm build

# 5. 重启
pm2 reload meimart-api
pm2 reload meimart-admin-web

# 6. 健康检查
curl https://api.meimart.com/api/v1/common/health
curl -I https://admin.meimart.com
```

### 4.3 上线后观察（前 1 小时）

- [ ] Sentry 无新错误
- [ ] API p99 < 500ms
- [ ] DB 连接数稳定 < 10
- [ ] Redis 内存稳定 < 50MB
- [ ] 至少跑通一次主链路（登录 → 下单 → 退款）

---

## 五、值班排查清单

遇到告警时按此顺序排查：

1. **看 Sentry**：错误堆栈 + traceId
2. **看日志**：按 traceId 串联请求链路
3. **看容器健康**：`docker compose ps`
4. **看 DB**：连接数 + 长事务 + 慢查询
5. **看 Redis**：内存 + 队列堆积
6. **看 MinIO**：bucket 存在 + 权限
7. **看 BullMQ**：未处理 job 数

---

## 六、回滚预案

### 6.1 代码回滚

```bash
# 回滚到上一版本
git log --oneline | head -5
git checkout <previous-commit>
pnpm install --frozen-lockfile
pnpm --filter @meimart/api prisma migrate deploy  # 可能需要 down migration
pnpm build
pm2 reload meimart-api
```

### 6.2 数据库回滚

⚠️ **migration 一旦 apply 不能改**，只能新增 migration 修正。

如果新 migration 引入问题：

```bash
# 紧急情况：用 pg_dump 恢复到上线前备份
./scripts/pg-restore-test.sh  # 演练
# 实际恢复需要停下 API + 用 latest.sql.gz 恢复
```

### 6.3 配置回滚

env 变更 → 改 `.env` → `pm2 reload`。无 schema 变更，秒级生效。

---

## 七、参考文档

- **部署指南**：`docs/deployment-guide.md`（域名 + SSL + 服务器 + UAT）
- **法律文档模板**：`docs/legal/`（隐私政策 + 用户协议 + 退款政策）
- **W7 验收报告**：`docs/W7-final-acceptance-report.md`
- **API 契约**：`packages/api-contract/openapi.yaml`（85 paths）
- **数据库 schema**：`apps/api/prisma/schema.prisma`（16 张基线表）

---

**报告版本**：v1.0
**最后更新**：2026-07-05
