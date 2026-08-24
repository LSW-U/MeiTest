-- F3 修复（2026-08-24 审查报告）：rider_profiles.tier / points 加 DB CHECK 约束
--
-- 背景：
--   migration 20260824000001_add_rider_personal_fields 给 tier TEXT NOT NULL DEFAULT 'BRONZE' / points INTEGER NOT NULL DEFAULT 0
--   但无 CHECK 约束，DB 层不拦非法 tier 值（如 'DIAMOND'），完全依赖应用层 `tier as RiderTier` 裸断言兜底。
--   一旦有 admin 批量改等级 / 导入脚本 / fire-and-forget 回写传错值，脏值会原样落库并返回前端。
--
-- 修复：
--   - tier 加 CHECK (tier IN ('BRONZE','SILVER','GOLD','PLATINUM'))，与 TIER_THRESHOLDS 4 档对齐
--   - points 加 CHECK (points >= 0)，配送积分不可负
--
-- migration 一旦 apply 不可修改（CLAUDE.md §全局约束-3），故新增本 migration 补约束，不改历史 migration。

ALTER TABLE "rider_profiles"
    ADD CONSTRAINT "rider_tier_check" CHECK ("tier" IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
    ADD CONSTRAINT "rider_points_check" CHECK ("points" >= 0);
