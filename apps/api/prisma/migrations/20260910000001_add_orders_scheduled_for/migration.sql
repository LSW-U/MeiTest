-- 保证金拦截链批A（T5-c，2026-09-10）：Order.scheduledFor 预约单承载
-- 打烊时段下单写入该仓下一次开门时间；即时单为 null。
-- 索引：骑手大厅可见性查询（scheduledFor <= now 过滤 + status）。
-- 写法注意（memory [[meimart-db-drift]]）：本仓 migrate dev 会检测 drift 要求 reset，
-- 走 migrate diff 提取本批 SQL + migrate deploy 绕过。单条普通索引无需 CONCURRENTLY
-- （加列 + 建索引原子执行，orders 表当前量级 MVP 可接受；参考 20260909000002 先例仅在
-- 大表加索引时才用 CONCURRENTLY 单独拆条）。

ALTER TABLE "orders" ADD COLUMN "scheduled_for" TIMESTAMP(3);

CREATE INDEX "orders_scheduled_for_status_idx" ON "orders"("scheduled_for", "status");
