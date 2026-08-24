-- 骑手个人区辅助（第三/四梯队后端配合，2026-08-24）
-- 补 5 个字段：
--   avatar_url / id_card_image_url / license_image_url —— apply 阶段上传回填 + update 可改
--   points / tier —— 配送积分（每完成 1 单 +10 分）+ 等级（BRONZE/SILVER/GOLD/PLATINUM）
-- 后缀 _m：本批属骑手资料范围，沿用 W2 命名（实际本仓库已合并三流程，后缀仅备忘）

ALTER TABLE "rider_profiles"
    ADD COLUMN "avatar_url" TEXT,
    ADD COLUMN "id_card_image_url" TEXT,
    ADD COLUMN "license_image_url" TEXT,
    ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'BRONZE';
