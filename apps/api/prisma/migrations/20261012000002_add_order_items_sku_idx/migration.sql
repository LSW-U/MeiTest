-- 后端性能清理 批1（方案 v2 §七）：order_items(sku_id) 缺失索引
-- 退款销量回滚路径按 skuId 查 order_items，现有索引
-- (order_id) 与 (product_id, order_id) 均不含 sku_id 前缀 → 全表扫。
-- 单条 CREATE INDEX CONCURRENTLY migration（先例 20260909000002）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_sku_id_idx"
  ON "order_items" ("sku_id");
