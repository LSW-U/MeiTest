-- P2-1 (1/2): pg_trgm 扩展（contrib 自带，postgres:16-alpine 默认有）
-- 单独成 migration：CREATE EXTENSION 可在事务内，与 CONCURRENTLY 索引分离
-- 来源：Obsidian P2-1+P2-3-搜索性能-方案-20260805.md §二
CREATE EXTENSION IF NOT EXISTS pg_trgm;
