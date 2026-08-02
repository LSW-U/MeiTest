-- P1 领券体系：UserCoupon 表 + UserCouponStatus enum（用户领券卡包）
CREATE TYPE "UserCouponStatus" AS ENUM ('UNUSED', 'USED', 'EXPIRED');

CREATE TABLE "user_coupons" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "promotion_id" TEXT NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "status" "UserCouponStatus" NOT NULL DEFAULT 'UNUSED',
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "used_at" TIMESTAMP(3),
  "order_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_coupons_user_id_promotion_id_key" ON "user_coupons"("user_id", "promotion_id");
CREATE INDEX "user_coupons_user_id_status_idx" ON "user_coupons"("user_id", "status");
CREATE INDEX "user_coupons_status_idx" ON "user_coupons"("status");

ALTER TABLE "user_coupons" ADD CONSTRAINT "user_coupons_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_coupons" ADD CONSTRAINT "user_coupons_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_coupons" ADD CONSTRAINT "user_coupons_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
