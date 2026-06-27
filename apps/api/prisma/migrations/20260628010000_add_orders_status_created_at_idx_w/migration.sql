-- W4.5 P0-3: admin 订单列表 (status, createdAt DESC) 复合索引
-- admin-web /orders 典型查询：按 status 筛选 + 按时间倒序
-- 现有 orders_status_idx（单列）只能筛 status，ORDER BY createdAt 走单独 sort
-- 复合索引让 WHERE + ORDER BY 一次走索引扫描

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_created_at_idx"
  ON "orders" ("status", "created_at" DESC);
