-- 批E 库存数量导入 UI · D5 v2 导入历史数据层（2026-09-07）
-- 来源：Obsidian 商品详情整合/方案v2-批E批F-库存导入细化-20260907.md §3.1（ImportLog 后端统一写）
--
-- 只加不改：1 张新表 import_logs，无 DROP/修改现有对象
-- 批F 商品批量导入（resourceType='Product'）复用本表，免重复迁移
--
-- ⚠️ 应用方式（同 20260902000001 文档化流程：migrate dev 过不了 trgm CONCURRENTLY 影子库）：
--   1. docker exec meimart-pg psql -U postgres -d meimart -v ON_ERROR_STOP=1 \
--        < prisma/migrations/20260907000001_add_import_logs_e/migration.sql
--   2. pnpm exec prisma migrate resolve --applied 20260907000001_add_import_logs_e
--
-- 回滚（dev 可用）：
--   DROP TABLE IF EXISTS "import_logs";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20260907000001_add_import_logs_e';

-- CreateTable
CREATE TABLE "import_logs" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "success_count" INTEGER NOT NULL,
    "failed_count" INTEGER NOT NULL,
    "failed_rows" JSONB NOT NULL,
    "operator_id" TEXT,
    "mode" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_logs_resource_type_created_at_idx" ON "import_logs"("resource_type", "created_at");

-- CreateIndex
CREATE INDEX "import_logs_operator_id_idx" ON "import_logs"("operator_id");
