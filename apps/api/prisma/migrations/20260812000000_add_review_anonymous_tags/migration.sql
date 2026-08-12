-- P15 B1: Review 加 anonymous + tags 字段（2026-08-11）
-- anonymous: 匿名评价标记（提交时定死，admin 不可改 - 用户隐私权利）
-- tags: 商品评价快捷标签（GoodsReviewTag 枚举值数组：good_quality/good_price/fresh/well_packaged/accurate_description/fast_delivery）
-- 与 RiderReview.tags 同模式 String[]，但商品评价枚举值不同
-- 手写 SQL 绕过 migrate dev（P3006 shadow DB 跑不了 CONCURRENTLY 历史迁移，per meimart-prisma-concurrently-deploy）

ALTER TABLE "reviews" ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reviews" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
