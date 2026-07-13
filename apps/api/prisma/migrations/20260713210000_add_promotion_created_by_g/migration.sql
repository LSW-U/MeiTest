-- W7-ext-G P1-4: Promotion 加 createdBy 审计字段
-- 创建人 user.id，纯字符串不加 FK（跟随 Refund.reviewedBy 模式）
-- NOT NULL DEFAULT '' 兼容已有行（开发阶段 promotions 表数据可忽略）

ALTER TABLE "promotions"
  ADD COLUMN "created_by" TEXT NOT NULL DEFAULT '';
