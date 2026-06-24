-- 流程 M（治理/财务）W2 扩展表
--   1. system_configs：平台 key-value 配置（W2 启用）
--   2. settlements：结算单（W3 启用，schema 提前建好避免后续迁移冲突）
--   3. withdrawal_requests：提现申请（W3 启用）
--
-- 命名规范：W2-COLLABORATION.md §3.2 — migration 末尾 _m 后缀
-- 不可修改：apply 后只能新增 migration 修正

-- ============================================================================
-- 1. system_configs
-- ============================================================================
CREATE TABLE "system_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);

-- ============================================================================
-- 2. settlements
-- ============================================================================
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "period_date" DATE NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "gross_amount" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "settlements_period_date_subject_type_subject_id_key"
    ON "settlements"("period_date", "subject_type", "subject_id");
CREATE INDEX "settlements_subject_type_status_idx"
    ON "settlements"("subject_type", "status");
CREATE INDEX "settlements_period_date_idx"
    ON "settlements"("period_date");

-- ============================================================================
-- 3. withdrawal_requests
-- ============================================================================
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "requester_type" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payout_account" JSONB NOT NULL,
    "reject_reason" TEXT,
    "payout_reference" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "withdrawal_requests_requester_type_status_idx"
    ON "withdrawal_requests"("requester_type", "status");
CREATE INDEX "withdrawal_requests_status_created_at_idx"
    ON "withdrawal_requests"("status", "created_at");
