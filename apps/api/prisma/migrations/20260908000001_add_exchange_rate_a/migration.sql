-- 批A 汇率体系（微信支付预留 2026-09-08，方案V2 §3.1）
-- 1) 新表 exchange_rates：USD→CNY 每日汇率，rate 万分位存（7.2345 → 72345）
-- 2) orders 加汇率快照两列（人民币通道下单锁汇率；非人民币通道 null）

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "rate_date" DATE NOT NULL,
    "from_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "to_currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
    "rate" INTEGER NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "operator_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex（每币种对每日一条，按日 upsert 落点）
CREATE UNIQUE INDEX "exchange_rates_rate_date_from_currency_to_currency_key" ON "exchange_rates"("rate_date", "from_currency", "to_currency");

-- 汇率快照（可空 = 非人民币通道订单）
ALTER TABLE "orders" ADD COLUMN "exchange_rate" INTEGER;
ALTER TABLE "orders" ADD COLUMN "estimated_cny_amount" INTEGER;
