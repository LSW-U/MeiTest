-- 批4 触达自动化（2026-10-18）
-- 1) outreach_triggers：每流每用户触发记录（幂等防重发 + skip 留痕）
-- 2) client_subscriptions：B2 补货提醒手工订阅（批5 升级自动预测时保留为订阅源）
CREATE TABLE "outreach_triggers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flow" VARCHAR(4) NOT NULL,
    "trigger_key" VARCHAR(120) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "skip_reason" VARCHAR(30),
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_triggers_pkey" PRIMARY KEY ("id")
);

-- 幂等锚点：同流同周期键同用户只允许一行（防重发唯一约束）
CREATE UNIQUE INDEX "outreach_triggers_flow_trigger_key_user_id_key" ON "outreach_triggers"("flow", "trigger_key", "user_id");
CREATE INDEX "outreach_triggers_user_id_created_at_idx" ON "outreach_triggers"("user_id", "created_at");
CREATE INDEX "outreach_triggers_flow_created_at_idx" ON "outreach_triggers"("flow", "created_at");

CREATE TABLE "client_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "cycle_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_subscriptions_pkey" PRIMARY KEY ("id")
);

-- 同商品一人一条订阅（重复订阅=改周期）
CREATE UNIQUE INDEX "client_subscriptions_user_id_product_id_key" ON "client_subscriptions"("user_id", "product_id");
CREATE INDEX "client_subscriptions_enabled_updated_at_idx" ON "client_subscriptions"("enabled", "updated_at");

-- AddForeignKey
ALTER TABLE "outreach_triggers" ADD CONSTRAINT "outreach_triggers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_subscriptions" ADD CONSTRAINT "client_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_subscriptions" ADD CONSTRAINT "client_subscriptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
