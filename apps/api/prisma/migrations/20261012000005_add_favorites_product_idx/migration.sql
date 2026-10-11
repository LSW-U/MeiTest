-- 后端性能清理 批1（方案 v2 §七）：favorites(product_id) 缺失索引
-- 按商品维度查收藏（商品下架/统计），现有 (user_id) 与
-- (user_id, product_id) 唯一索引均 product_id 非前缀不可用 → 全表扫。
-- 单条 CREATE INDEX CONCURRENTLY migration（先例 20260909000002）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "favorites_product_id_idx"
  ON "favorites" ("product_id");
