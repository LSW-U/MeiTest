-- 批2（后端依赖专项 2026-10-01）：DeliveryTask 加取证照片字段（只增不改）
ALTER TABLE "delivery_tasks" ADD COLUMN "evidence_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];
