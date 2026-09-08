-- 批C 对账分流（微信支付预留 2026-09-08，方案V2 §3.3）
-- 1) 新表 statement_import_batches：对账单导入批次（复用 ImportLog 模式，本轮只预留结构，不做真实导入）
-- 2) 新表 reconciliation_ledger：对账台账，统一承载 COD 现金与线上两股资金流（orderId @unique 幂等）
-- 纯增量变更（无改列/无删表），不触碰历史 drift 项

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'DIFF', 'SETTLED');
CREATE TYPE "StatementFormat" AS ENUM ('WECHAT', 'ALIPAY', 'BANK');

-- CreateTable
CREATE TABLE "statement_import_batches" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "format" "StatementFormat" NOT NULL,
    "row_count" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL,
    "failed_count" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "operator_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_ledger" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "amount_usd" INTEGER NOT NULL,
    "exchange_rate" INTEGER,
    "amount_cny" INTEGER,
    "cash_result" TEXT,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "statement_batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_ledger_order_id_key" ON "reconciliation_ledger"("order_id");
CREATE INDEX "reconciliation_ledger_payment_method_status_idx" ON "reconciliation_ledger"("payment_method", "status");
CREATE INDEX "reconciliation_ledger_order_no_idx" ON "reconciliation_ledger"("order_no");
CREATE INDEX "reconciliation_ledger_created_at_idx" ON "reconciliation_ledger"("created_at");
CREATE INDEX "statement_import_batches_format_created_at_idx" ON "statement_import_batches"("format", "created_at");

-- AddForeignKey
ALTER TABLE "reconciliation_ledger" ADD CONSTRAINT "reconciliation_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_ledger" ADD CONSTRAINT "reconciliation_ledger_statement_batch_id_fkey" FOREIGN KEY ("statement_batch_id") REFERENCES "statement_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
