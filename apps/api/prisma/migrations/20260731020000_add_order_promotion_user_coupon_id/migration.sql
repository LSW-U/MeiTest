-- P1 领券体系：OrderPromotion 加 userCouponId 关联 UserCoupon
-- 下单用券（applyCoupon）时写入，关联到用户的 UserCoupon 实例（追溯用）。
-- 旧码即用流程的历史记录 userCouponId 为 NULL（向后兼容）。

-- AlterTable
ALTER TABLE "order_promotions" ADD COLUMN "user_coupon_id" TEXT;

-- CreateIndex
CREATE INDEX "order_promotions_user_coupon_id_idx" ON "order_promotions"("user_coupon_id");

-- AddForeignKey
ALTER TABLE "order_promotions"
  ADD CONSTRAINT "order_promotions_user_coupon_id_fkey"
  FOREIGN KEY ("user_coupon_id") REFERENCES "user_coupons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
