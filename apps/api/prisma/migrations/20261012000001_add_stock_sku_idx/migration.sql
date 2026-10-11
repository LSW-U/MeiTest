-- 后端性能清理 批1（方案 v2 §七）：stocks(sku_id) 缺失索引
-- batchGetProductStock（catalog.service.ts）按 skuId 批量查库存，现状仅
-- (warehouse_id, sku_id) 唯一索引，sku_id 前缀不可用 → 全表扫。
-- 单条 CREATE INDEX CONCURRENTLY migration（先例 20260909000002），
-- 不可与其他 CONCURRENTLY 合入同文件，否则 5.22 deploy 报 25001。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stocks_sku_id_idx"
  ON "stocks" ("sku_id");
