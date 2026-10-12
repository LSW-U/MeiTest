-- P2-1 (2/2): catalog 搜索性能 - 5 语言 name trigram GIN 表达式索引
-- 让 raw ILIKE '%kw%' 走 trigram 索引（catalog.service.ts 5 语言 OR raw ILIKE）
-- 来源：Obsidian P2-1+P2-3-搜索性能-方案-20260805.md §二；POC 验证 docs/poc/w3-catalog-trgm-poc/
--
-- 表达式索引 (name->>'lang') 而非 jsonb GIN：jsonb GIN 只加速 @>/?，不加速 ->> 后 ILIKE
-- 5 语言全建：catalog.service 5 语言 OR 查询要每支都走索引规划器才能 BitmapOr 合并
-- IF NOT EXISTS 幂等
-- 注意：Prisma 不支持表达式索引 @@index 声明，schema.prisma 仅注释占位（见 Product model）
--
-- 批1 增补（20261012，总指挥拍板 v2.1）：原 5 条 CREATE INDEX CONCURRENTLY（5 语言索引，git 历史
--   为准）改写为普通 CREATE INDEX IF NOT EXISTS——Prisma migrate deploy 会把整个 migration
--   包进事务，多条 CONCURRENTLY 报 25001，干库 fresh deploy 从未走通过（历来靠 psql 直 apply +
--   migrate resolve --applied 补票）。存量 dev/prod 库早已手工 apply，无需重跑；改普通语句后
--   shadow 回放不再 P3006，干库 migrate deploy 全程可走通。
-- 沉淀规则（交付说明）：新 migration 禁用 CONCURRENTLY；大表在线加索引用运维脚本（psql 直跑）
--   + prisma migrate resolve --applied 记账。
CREATE INDEX IF NOT EXISTS "products_name_en_trgm"
  ON "products" USING gin ((name->>'en') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_name_zh_trgm"
  ON "products" USING gin ((name->>'zh') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_name_id_trgm"
  ON "products" USING gin ((name->>'id') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_name_pt_trgm"
  ON "products" USING gin ((name->>'pt') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_name_tet_trgm"
  ON "products" USING gin ((name->>'tet') gin_trgm_ops);
