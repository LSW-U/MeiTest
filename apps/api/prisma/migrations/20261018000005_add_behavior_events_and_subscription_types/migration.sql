-- 批5 行为采集 + 订阅类（2026-10-18）
-- 1) behavior_events：行为埋点（VIEW 浏览 / SEARCH_CLICK 搜索点击）——B4 浏览未买 / D5 漏斗 / A8 流失信号共同地基
-- 2) client_subscriptions：订阅类型扩展（REPLENISH 存量默认 + PRICE_ALERT 降价 + RESTOCK_ALERT 到货）

CREATE TABLE "behavior_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "product_id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavior_events_pkey" PRIMARY KEY ("id")
);

-- B4 浏览未买（按用户+类型扫） / D5 漏斗（按类型+时间聚合） / 商品侧浏览热度
CREATE INDEX "behavior_events_user_id_type_created_at_idx" ON "behavior_events"("user_id", "type", "created_at");
CREATE INDEX "behavior_events_type_created_at_idx" ON "behavior_events"("type", "created_at");
CREATE INDEX "behavior_events_product_id_type_created_at_idx" ON "behavior_events"("product_id", "type", "created_at");

-- AlterTable：订阅类型扩展（存量行默认 REPLENISH 保持批4 语义）+ 降价订阅价格快照
ALTER TABLE "client_subscriptions" ADD COLUMN "type" VARCHAR(20) NOT NULL DEFAULT 'REPLENISH';
ALTER TABLE "client_subscriptions" ADD COLUMN "price_at_sub" INTEGER;

-- 唯一约束从 (user_id, product_id) 放宽为 (user_id, product_id, type)——一人可同商品同时三种订阅
DROP INDEX "client_subscriptions_user_id_product_id_key";
CREATE UNIQUE INDEX "client_subscriptions_user_id_product_id_type_key" ON "client_subscriptions"("user_id", "product_id", "type");
CREATE INDEX "client_subscriptions_type_enabled_idx" ON "client_subscriptions"("type", "enabled");
