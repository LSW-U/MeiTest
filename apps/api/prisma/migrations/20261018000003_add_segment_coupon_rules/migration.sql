-- 批2 分层运营（C5 分层定向券规则，2026-10-18）
-- 规则表：按 RFM 生命周期层配券，与批4 自动化流共用 grant 端点
CREATE TABLE "segment_coupon_rules" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_coupon_rules_pkey" PRIMARY KEY ("id")
);

-- 同层同券唯一（防重复配置）
CREATE UNIQUE INDEX "segment_coupon_rules_stage_promotion_id_key" ON "segment_coupon_rules"("stage", "promotion_id");
CREATE INDEX "segment_coupon_rules_stage_idx" ON "segment_coupon_rules"("stage");

-- AddForeignKey
ALTER TABLE "segment_coupon_rules" ADD CONSTRAINT "segment_coupon_rules_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
