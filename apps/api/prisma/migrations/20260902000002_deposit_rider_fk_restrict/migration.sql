-- 批A遗留 FK 修正（2026-09-02）：rider_deposits.rider_id CASCADE → RESTRICT
--
-- 用户裁决：保证金流水 = 财务审计证据，Cascade 会销毁历史（对账/退款/仲裁无依据）；
--   有流水的骑手本就不该被直接删，Restrict 强制「先退款再删」。
-- 只动批A新建对象（20260902000001 里建的约束），无其他改动。
--
-- 应用方式（同 20260902000001，migrate dev 被 trgm 影子库问题挡住）：
--   docker exec -i meimart-pg psql -U postgres -d meimart -v ON_ERROR_STOP=1 \
--     < prisma/migrations/20260902000002_deposit_rider_fk_restrict/migration.sql
--   pnpm exec prisma migrate resolve --applied 20260902000002_deposit_rider_fk_restrict
--
-- 回滚（恢复 Cascade）：
--   ALTER TABLE "rider_deposits" DROP CONSTRAINT "rider_deposits_rider_id_fkey";
--   ALTER TABLE "rider_deposits" ADD CONSTRAINT "rider_deposits_rider_id_fkey"
--     FOREIGN KEY ("rider_id") REFERENCES "rider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20260902000002_deposit_rider_fk_restrict';

ALTER TABLE "rider_deposits" DROP CONSTRAINT "rider_deposits_rider_id_fkey";

ALTER TABLE "rider_deposits" ADD CONSTRAINT "rider_deposits_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "rider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
