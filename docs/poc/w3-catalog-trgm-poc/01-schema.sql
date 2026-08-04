-- P2-1 POC schema：仿 products.name jsonb（5 语言）
-- 仅 name 字段 + id，POC 不需要其他列
DROP TABLE IF EXISTS products;
CREATE TABLE products (
  id text PRIMARY KEY,
  name jsonb NOT NULL
);
