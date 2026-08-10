-- P13 售后图片：Refund.photos 字段（凭证照片 URL 数组，同 Review.images 模式）
-- 走 migrate diff + deploy（per meimart-db-drift，migrate dev 会 reset 整库）
-- 手动剔除 diff 中的 drift 改动（备份表/索引命名/FK onDelete/默认值），只留 photos 相关

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
