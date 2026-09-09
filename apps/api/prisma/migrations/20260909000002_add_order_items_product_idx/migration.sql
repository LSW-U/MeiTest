-- 统计查询公共层 批A（2026-09-09）：order_items 聚合索引
-- 商品排行（R9）按 OrderItem groupBy productId 聚合，现状全库仅 order_items_order_id_idx，
-- 大范围（≥90 天）聚合会走全表扫。补 (product_id, order_id) 复合索引：
--   - product_id 前缀服务 groupBy productId
--   - order_id 第二列保留既有「按订单取 items」查询的覆盖能力
-- 写法注意（memory [[meimart-prisma-concurrently-deploy]]）：单条 CREATE INDEX CONCURRENTLY
-- migration，prisma migrate deploy 会自动跳过事务块（先例：20260628010000 同型 migration）。
-- 不可与其它 CONCURRENTLY 语句合入同一条 migration，否则 5.22 检测失败报 25001。

CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_product_id_order_id_idx"
  ON "order_items" ("product_id", "order_id");
