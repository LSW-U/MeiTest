-- 批A 销量真实统计（商品详情整合 2026-09-07）
-- SalesCountLog：salesCount 全程审计日志（ORDER 累加 / REFUND 回滚 / ADMIN_ADJUST 批C 预留）
-- 不建 FK：审计日志独立于商品/订单生命周期（商品或订单被清理后日志仍可查）

-- CreateEnum
CREATE TYPE "SalesCountChangeType" AS ENUM ('ORDER', 'REFUND', 'ADMIN_ADJUST');

-- CreateTable
CREATE TABLE "sales_count_logs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "order_id" TEXT,
    "change_type" "SalesCountChangeType" NOT NULL,
    "change_qty" INTEGER NOT NULL,
    "before_qty" INTEGER NOT NULL,
    "after_qty" INTEGER NOT NULL,
    "operator_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_count_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_count_logs_product_id_created_at_idx" ON "sales_count_logs"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_count_logs_order_id_idx" ON "sales_count_logs"("order_id");
