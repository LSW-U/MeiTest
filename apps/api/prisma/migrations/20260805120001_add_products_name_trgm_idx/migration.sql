-- P2-1 (2/2): catalog 搜索性能 - 5 语言 name trigram GIN 表达式索引
-- 让 raw ILIKE '%kw%' 走 trigram 索引（catalog.service.ts 5 语言 OR raw ILIKE）
-- 来源：Obsidian P2-1+P2-3-搜索性能-方案-20260805.md §二；POC 验证 docs/poc/w3-catalog-trgm-poc/
--
-- 表达式索引 (name->>'lang') 而非 jsonb GIN：jsonb GIN 只加速 @>/?，不加速 ->> 后 ILIKE
-- 5 语言全建：catalog.service 5 语言 OR 查询要每支都走索引规划器才能 BitmapOr 合并
-- CONCURRENTLY 不锁表（dev/prod 已有数据），IF NOT EXISTS 幂等
-- 注意：Prisma 不支持表达式索引 @@index 声明，schema.prisma 仅注释占位（见 Product model）
--
-- ⚠️ 部署注意（prisma migrate deploy 5.22 不会自动跳事务）：
--   实测 prisma 5.22 对多条 CONCURRENTLY 的 migration 仍包事务（单条 CONCURRENTLY 可自动跳，
--   见 add_orders_status_created_at_idx_w；多条 + 表达式索引语法不匹配检测正则），deploy 报
--   25001 "CREATE INDEX CONCURRENTLY cannot run inside a transaction block"。
--   deploy 流程（dev 已按此 apply，生产同）：
--   1. prisma migrate deploy（add_pg_trgm_extension 自动成功；本 migration 报 25001 失败）
--   2. psql -d $DB -v ON_ERROR_STOP=1 < prisma/migrations/20260805120001_add_products_name_trgm_idx/migration.sql
--   3. prisma migrate resolve --applied 20260805120001_add_products_name_trgm_idx
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_name_en_trgm"
  ON "products" USING gin ((name->>'en') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_name_zh_trgm"
  ON "products" USING gin ((name->>'zh') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_name_id_trgm"
  ON "products" USING gin ((name->>'id') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_name_pt_trgm"
  ON "products" USING gin ((name->>'pt') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_name_tet_trgm"
  ON "products" USING gin ((name->>'tet') gin_trgm_ops);
