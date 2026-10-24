-- 缺货履约闭环批1（2026-10-24）：OrderItem 缺货 5 字段 + out_of_stock_rule 规则配置表 + OrderEventType 枚举值
-- 只增不改：全部可空新增 / 新表 / 枚举追加，既有行与查询不受影响（验收清单批1 第1条）
-- D18：缺货字段永久保留（不清空不重置），两账分离（RefundItem=打款事实 / 本字段=登记事实）

-- 1. OrderItem 加 5 字段（evidence_urls 默认空数组，避免应用层 null 分支）
ALTER TABLE "order_items" ADD COLUMN "out_of_stock_qty" INTEGER;
ALTER TABLE "order_items" ADD COLUMN "out_of_stock_reason" TEXT;
ALTER TABLE "order_items" ADD COLUMN "out_of_stock_note" TEXT;
ALTER TABLE "order_items" ADD COLUMN "out_of_stock_evidence_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "order_items" ADD COLUMN "suggestion_item_id" TEXT;

-- 2. OrderEventType 枚举追加 OUT_OF_STOCK_REPORTED（只增不改）
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'OUT_OF_STOCK_REPORTED';

-- 3. out_of_stock_rule 规则配置表（D15：3 开关 + 免审上限 + 可空 warehouseId scope）
CREATE TABLE "out_of_stock_rule" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "auto_refund_full_shortage" BOOLEAN NOT NULL DEFAULT true,
    "partial_shortage_threshold_enabled" BOOLEAN NOT NULL DEFAULT false,
    "partial_shortage_threshold_bp" INTEGER,
    "report_timeout_enabled" BOOLEAN NOT NULL DEFAULT false,
    "report_timeout_minutes" INTEGER,
    "auto_refund_max_amount" INTEGER NOT NULL DEFAULT 5000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "out_of_stock_rule_pkey" PRIMARY KEY ("id")
);

-- 全局兜底行唯一（warehouse_id IS NULL 至多一行）+ 仓库精确行唯一（同 warehouse_id 至多一行）
-- Prisma 不支持部分唯一索引 → raw SQL（同 GIST 索引惯例）
CREATE UNIQUE INDEX "out_of_stock_rule_warehouse_id_key" ON "out_of_stock_rule"("warehouse_id");

-- 批3 规则引擎按 scope 查询用
CREATE INDEX "out_of_stock_rule_warehouse_id_idx" ON "out_of_stock_rule"("warehouse_id");

ALTER TABLE "out_of_stock_rule" ADD CONSTRAINT "out_of_stock_rule_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
