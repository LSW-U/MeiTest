-- 引导页 slide 独立表（引导页内容可配置 批1，2026-10-14）
-- SystemConfig 为 key-value 字符串存储，不适合结构化多行 slides（方案v2 D1 拍板独立表）
CREATE TABLE "onboarding_slides" (
    "id" TEXT NOT NULL,
    "icon" TEXT,
    "image_url" TEXT,
    "title" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_slides_pkey" PRIMARY KEY ("id")
);

-- 客户端读取端点固定查询：WHERE enabled ORDER BY sort_order
CREATE INDEX "onboarding_slides_enabled_sort_order_idx" ON "onboarding_slides"("enabled", "sort_order");
