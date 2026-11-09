-- P3体验增强 批1（2026-11-09）：Product 保质期天数（临期标注）
-- 只增不改：仅加可空列，无默认值回填、无 CONCURRENTLY
ALTER TABLE "products" ADD COLUMN "shelf_life_days" INTEGER;
