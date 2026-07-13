-- W7-ext-G: Promotion 表 + 2 enum
-- 3 类型促销（PERCENTAGE / FIXED_AMOUNT / FREE_DELIVERY）+ 配额 + 用户限制 + 时间窗

CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY');

CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');

CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "value" INTEGER NOT NULL,
    "min_order_amount" INTEGER NOT NULL DEFAULT 0,
    "max_discount_amount" INTEGER,
    "total_quota" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 1,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_status_start_at_end_at_idx" ON "promotions"("status", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "promotions_code_idx" ON "promotions"("code");
