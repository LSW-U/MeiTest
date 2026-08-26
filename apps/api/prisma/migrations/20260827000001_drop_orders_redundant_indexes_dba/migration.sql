-- DBA 批次1-4 schema 同步迁移（2026-08-27）
-- 移除 orders 冗余索引，与 schema.prisma 声明对齐
--
-- 背景：orders 的两个普通索引与既有索引重复：
--   - orders_order_no_idx  → 被 UQ orders_order_no_key 覆盖（orderNo 已 @unique 自动建 UQ B-tree）
--   - orders_status_idx    → 被 orders_status_created_at_idx(status, created_at DESC) 最左前缀覆盖
-- schema.prisma 对应的 @@index([orderNo]) 与 @@index([status]) 声明已移除（见 schema.prisma 注释）。
--
-- 用 IF EXISTS 而非空操作：保证幂等——
--   - 当前库（批次1-4 已 DROP 过）执行时索引不存在，IF EXISTS 跳过，无副作用；
--   - 全新库执行 init 迁移会重建这两个索引（init 声明过 @@index([orderNo])/@@index([status])，
--     本迁移随后把它们 DROP 掉），使全新库与当前库终态一致。
-- 不用 CONCURRENTLY：prisma migrate 在事务块内执行迁移 SQL，CONCURRENTLY 无法在事务内运行；
-- 本迁移作为正式 migrate 流程执行（非 batch1-4 的手动 psql -c），故用普通 DROP INDEX。
-- 详见《数据库优化/优化工作流程/批次1-备份恢复与低风险优化/执行记录.md》§1-4
-- 与《00-数据库变更记录.md》批次1-4 / 批次1-4 schema 同步条目。

DROP INDEX IF EXISTS "orders_order_no_idx";
DROP INDEX IF EXISTS "orders_status_idx";
