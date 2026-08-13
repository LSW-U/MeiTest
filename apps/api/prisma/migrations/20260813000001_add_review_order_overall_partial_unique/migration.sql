-- P15 P3-1：productId=null（订单整体/配送评论）并发漏洞加固
-- 联合 unique [orderId, productId] 对 null 不去重（Postgres 语义 null != null），
-- 加 partial unique index 只对 product_id IS NULL 的行强制 order_id 唯一
-- （订单整体/配送评论一订单一条，堵并发双击/恶意并发）
-- 决策反转：用户 2026-08-13 改选 partial unique（原 2026-08-12 选 A 接受多条 → 审查 P3-1 标并发漏洞）
-- prisma 不支持 partial unique index 的 schema 表达，本索引仅在 migration 管理（schema.prisma 加注释）
-- 手写 SQL 绕 P3006 shadow DB（per meimart-prisma-concurrently-deploy）

CREATE UNIQUE INDEX reviews_order_overall_unique ON "reviews" USING btree (order_id) WHERE product_id IS NULL;
