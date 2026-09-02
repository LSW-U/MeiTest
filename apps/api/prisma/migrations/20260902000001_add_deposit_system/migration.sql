-- 保证金与派单体系 · 批 A 数据层（2026-09-02）
-- 来源：Obsidian 保证金与派单体系方案/02-CC任务书-后端接口.md 批 A
--
-- 只加不改：3 张新表 + rider_profiles.deposit_amount 字段，无任何 DROP/修改现有对象
-- （diff 里检出的 orders 索引 / GIST / FK 改名等 drift 为既有漂移，不属于本迁移，见
--   memory meimart-db-drift 与 20260805120001 trgm 迁移头部说明）
--
-- ⚠️ 应用方式（migrate dev 因 trgm CONCURRENTLY 迁移无法过影子库，本 repo 文档化流程）：
--   1. docker exec meimart-pg psql -U postgres -d meimart -v ON_ERROR_STOP=1 \
--        < prisma/migrations/20260902000001_add_deposit_system/migration.sql
--   2. pnpm exec prisma migrate resolve --applied 20260902000001_add_deposit_system
--
-- 回滚（dev 可用，逆序执行；⚠️ FK 已被 20260902000002 改为 RESTRICT，先跑该迁移的回滚）：
--   DROP TABLE IF EXISTS "rider_deposits";
--   DROP TABLE IF EXISTS "deposit_locations";
--   DROP TABLE IF EXISTS "rider_deposit_tiers";
--   DROP TYPE IF EXISTS "RiderDepositStatus";
--   DROP TYPE IF EXISTS "RiderDepositChannel";
--   ALTER TABLE "rider_profiles" DROP COLUMN IF EXISTS "deposit_amount";
--   DELETE FROM _prisma_migrations WHERE migration_name LIKE '2026090200000%_add_deposit_system';

-- CreateEnum
CREATE TYPE "RiderDepositChannel" AS ENUM ('ONLINE_MOCK', 'OFFLINE_COD');

-- CreateEnum
CREATE TYPE "RiderDepositStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED');

-- AlterTable
ALTER TABLE "rider_profiles" ADD COLUMN "deposit_amount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "rider_deposit_tiers" (
    "id" TEXT NOT NULL,
    "min_amount" INTEGER NOT NULL,
    "max_order_amount" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rider_deposit_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_deposits" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "channel" "RiderDepositChannel" NOT NULL,
    "requested_amount" INTEGER NOT NULL,
    "confirmed_amount" INTEGER,
    "status" "RiderDepositStatus" NOT NULL DEFAULT 'PENDING',
    "location_id" TEXT,
    "note" TEXT,
    "admin_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "rider_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rider_deposit_tiers_min_amount_key" ON "rider_deposit_tiers"("min_amount");

-- CreateIndex
CREATE INDEX "rider_deposits_rider_id_created_at_idx" ON "rider_deposits"("rider_id", "created_at");

-- CreateIndex
CREATE INDEX "rider_deposits_status_created_at_idx" ON "rider_deposits"("status", "created_at");

-- AddForeignKey
ALTER TABLE "rider_deposits" ADD CONSTRAINT "rider_deposits_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "rider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_deposits" ADD CONSTRAINT "rider_deposits_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "deposit_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
