-- P13 部分退款：RefundItem 子表（2026-08-08）
-- 存「本次退款退了哪些 OrderItem 的多少数量」；整单退款不建子表（Refund.items 为空数组）
-- subtotal = unitPrice × refundQty，冗余存下单时价格快照（与 OrderItem.unitPrice 一致）
CREATE TABLE "refund_items" (
    "id" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "product_name" JSONB NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "refund_qty" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
);

-- 外键：refund_id -> refunds.id（onDelete: Cascade，退款删则子项级联删）
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_fkey"
    FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE;

-- 索引（按 refundId 查子项 / 按 orderItemId 反查某商品被哪些退款覆盖）
CREATE INDEX "refund_items_refund_id_idx" ON "refund_items"("refund_id");
CREATE INDEX "refund_items_order_item_id_idx" ON "refund_items"("order_item_id");
