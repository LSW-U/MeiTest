-- P17 B1（2026-08-17）：User 加通知偏好 JSON 列
-- {orderUpdates, promotions, system} 三布尔，null=默认全 true（应用层兜底）
-- 手写 SQL 绕 P3006 shadow DB（per meimart-prisma-concurrently-deploy）

ALTER TABLE "users" ADD COLUMN "notification_preferences" JSONB;
