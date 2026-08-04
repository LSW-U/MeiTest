-- P2-1 POC：建 pg_trgm 扩展 + 5 语言 GIN 表达式索引
-- 测试库小数据无并发，不用 CONCURRENTLY（生产 migration 才用）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX products_name_en_trgm  ON products USING gin ((name->>'en')  gin_trgm_ops);
CREATE INDEX products_name_zh_trgm  ON products USING gin ((name->>'zh')  gin_trgm_ops);
CREATE INDEX products_name_id_trgm  ON products USING gin ((name->>'id')  gin_trgm_ops);
CREATE INDEX products_name_pt_trgm  ON products USING gin ((name->>'pt')  gin_trgm_ops);
CREATE INDEX products_name_tet_trgm ON products USING gin ((name->>'tet') gin_trgm_ops);

ANALYZE products;

\echo '已建索引：'
SELECT indexname FROM pg_indexes WHERE tablename = 'products' ORDER BY indexname;
