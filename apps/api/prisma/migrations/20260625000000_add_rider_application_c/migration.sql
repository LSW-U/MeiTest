-- Flow C W3: 骑手入驻审核 + 实名认证字段
-- 决策依据：契约 v0.3 + W-M-C-T 任务分解 W3 流程 C M3 rider C1 入驻
-- 字段命名遵循 snake_case 数据库列名 + camelCase Prisma 字段映射
-- 不引入新 enum（用 TEXT，避免 enum migration 与流程 W/M 撞）
-- application_status: 'PENDING' | 'APPROVED' | 'REJECTED'

ALTER TABLE "rider_profiles"
  ADD COLUMN "application_status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "id_card_number" TEXT,
  ADD COLUMN "reviewed_by_id" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reject_reason" TEXT;

-- 骑手偏好仓库（M3 C2 按仓库分组派单用），text[] 列表
ALTER TABLE "rider_profiles"
  ADD COLUMN "preferred_warehouse_ids" TEXT[] DEFAULT '{}';

-- 索引：按审核状态筛选（admin 审核列表）
CREATE INDEX "idx_rider_profiles_application_status" ON "rider_profiles" ("application_status");
