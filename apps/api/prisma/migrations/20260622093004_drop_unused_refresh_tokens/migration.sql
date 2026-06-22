-- M-1 删除未使用的 RefreshToken 表
--   原设计：DB 表 + Redis 黑名单双写，但代码只写 Redis（auth.service.ts:133-142）
--   风险：Redis 重启黑名单丢失 → 已 logout token 复活
--   决策：MVP 只依赖 Redis（单点风险接受，W7 上线前评估是否补 DB 兜底）
--
-- 注意：Prisma 把 init migration 手补的 GIST 索引当成 drift 想一起 DROP
--       （PostGIS 索引无法用 schema.prisma 语法表达）
--       本 migration 显式保留 GIST（不删），并在末尾 CREATE IF NOT EXISTS 兜底
--       防 schema reset 后索引丢失

-- DropForeignKey（refresh_tokens 引用 users 的外键）
ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "refresh_tokens_user_id_fkey";

-- DropTable（M-1 真正目的）
DROP TABLE IF EXISTS "refresh_tokens";

-- GIST 索引兜底（防 reset 后丢失，W1 README 已知问题）
CREATE INDEX IF NOT EXISTS "idx_warehouses_coverage_gist"
  ON "warehouses" USING GIST ("coverageArea");

CREATE INDEX IF NOT EXISTS "idx_warehouses_center_gist"
  ON "warehouses" USING GIST ("centerPoint");
