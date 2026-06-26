-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- 注意：prisma migrate dev 自动生成了 DROP INDEX "idx_warehouses_center_gist" / "idx_warehouses_coverage_gist"
-- 这是 prisma 的 false positive（PostGIS GIST 索引走 raw SQL，prisma schema 表达不了）
-- W3-W 流程 P0-2 修复时手动删除这两行 DROP INDEX，避免破坏空间索引（参考 CLAUDE.md §数据库 Migration）

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE';
