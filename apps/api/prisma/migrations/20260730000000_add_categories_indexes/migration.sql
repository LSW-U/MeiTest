-- 子分类功能：categories 表补索引
-- parent_id：建树/查子分类（WHERE parent_id = ?）
-- (status, sort_order)：client/admin 列表过滤 ACTIVE + 排序
CREATE INDEX IF NOT EXISTS "categories_parent_id_idx" ON "categories"("parent_id");
CREATE INDEX IF NOT EXISTS "categories_status_sort_order_idx" ON "categories"("status", "sort_order");
