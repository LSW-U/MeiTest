-- 批F 商品批量导入 · Sku 判重双键数据层（2026-09-07）
-- 来源：Obsidian 商品详情整合/方案v2-批E批F-库存导入细化-20260907.md §3.2 / D1
--
-- 只加不改：2 个可空列 + 2 个唯一索引，无 DROP/修改现有对象
-- 向后兼容（任务书 §2.1.1）：可空唯一允许多 NULL——既有 Sku 行两列均 NULL，
--   批B 聚合接口（skus 数组）与批C SKU tab 完全无感；创建 SKU（admin 手动）不填也不受影响
--   （dedupeHash/skuCode 仅商品导入路径写入）
--
-- ⚠️ 应用方式（同 20260902000001 文档化流程：migrate dev 过不了 trgm CONCURRENTLY 影子库）：
--   1. docker exec -i meimart-pg psql -U postgres -d meimart -v ON_ERROR_STOP=1 \
--        < prisma/migrations/20260907000003_add_sku_dedupe_keys_f/migration.sql
--   2. pnpm exec prisma migrate resolve --applied 20260907000003_add_sku_dedupe_keys_f
--
-- 回滚（dev 可用）：
--   DROP INDEX IF EXISTS "skus_dedupe_hash_key";
--   DROP INDEX IF EXISTS "skus_sku_code_key";
--   ALTER TABLE "skus" DROP COLUMN IF EXISTS "dedupe_hash";
--   ALTER TABLE "skus" DROP COLUMN IF EXISTS "sku_code";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20260907000003_add_sku_dedupe_keys_f';

-- AlterTable
ALTER TABLE "skus" ADD COLUMN "sku_code" TEXT;
ALTER TABLE "skus" ADD COLUMN "dedupe_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "skus_sku_code_key" ON "skus"("sku_code");

-- CreateIndex
CREATE UNIQUE INDEX "skus_dedupe_hash_key" ON "skus"("dedupe_hash");
