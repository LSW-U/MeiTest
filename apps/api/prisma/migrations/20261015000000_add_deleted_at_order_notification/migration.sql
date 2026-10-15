-- P26/P27 批B1（2026-10-15）：通知 + 订单软删字段
-- P26：客户端删除通知（D9 拍板软删）
ALTER TABLE "notifications" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- P27：客户端删除订单（D8 拍板软删），client list/detail/counts 过滤走 (user_id, deleted_at)
ALTER TABLE "orders" ADD COLUMN "deleted_at" TIMESTAMP(3);
CREATE INDEX "orders_user_id_deleted_at_idx" ON "orders"("user_id", "deleted_at");
