-- P15 多商品评价：Review.orderId @unique -> @@unique([orderId, productId])
-- 同订单同商品不重复评（productId 有值时联合唯一拦）；不同商品可各评一条
-- productId=null（订单整体评论）可多条：Postgres 联合唯一对 null 不去重（用户 2026-08-12 选 A 接受多条）
-- 手写 SQL 绕 P3006 shadow DB（per meimart-prisma-concurrently-deploy）

DROP INDEX IF EXISTS reviews_order_id_key;
CREATE UNIQUE INDEX review_order_product_unique ON "reviews" USING btree (order_id, product_id);
