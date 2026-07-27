-- reviews-1: 评论中心 schema 扩展（Review 扩展 + RiderReview 新建 + enum）
-- 注意：仅含 review 相关改动。项目历史 drift（products_name_backup 表 / 索引命名 / refunds FK / promotion 默认值）
--   不在本 migration 处理，避免误删备份表与无关索引。

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewCategory" AS ENUM ('PRODUCT', 'DELIVERY');

-- AlterTable: reviews 加审核/分类/回复/商品绑定列（status 有默认 APPROVED；category NOT NULL，reviews 表空安全）
ALTER TABLE "reviews" ADD COLUMN     "category" "ReviewCategory" NOT NULL,
ADD COLUMN     "product_id" TEXT,
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "reply" JSONB,
ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateTable: rider_reviews（骑手评价，独立于 reviews）
CREATE TABLE "rider_reviews" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "tags" TEXT[],
    "comment" JSONB,
    "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rider_reviews_order_id_key" ON "rider_reviews"("order_id");

CREATE INDEX "rider_reviews_rider_id_status_idx" ON "rider_reviews"("rider_id", "status");

CREATE INDEX "rider_reviews_user_id_idx" ON "rider_reviews"("user_id");

CREATE INDEX "reviews_category_status_idx" ON "reviews"("category", "status");

CREATE INDEX "reviews_product_id_idx" ON "reviews"("product_id");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_reviews" ADD CONSTRAINT "rider_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_reviews" ADD CONSTRAINT "rider_reviews_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rider_reviews" ADD CONSTRAINT "rider_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
