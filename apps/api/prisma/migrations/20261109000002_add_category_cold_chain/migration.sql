-- P3体验增强 批2（2026-11-09）：Category 冷链标识（D2）
-- 只增不改：仅加带默认值的布尔列，存量分类默认 false、无 CONCURRENTLY
ALTER TABLE "categories" ADD COLUMN "cold_chain" BOOLEAN NOT NULL DEFAULT false;
