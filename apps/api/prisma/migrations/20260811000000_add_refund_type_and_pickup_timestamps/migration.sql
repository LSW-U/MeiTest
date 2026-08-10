-- P14-defer：Refund 加 refundType + pickupAt/pickedAt 字段
-- 走 migrate diff + deploy（per meimart-db-drift，migrate dev 会 reset 整库丢数据）
-- 手动剔除 diff 中的 drift 改动（备份表/索引命名/FK onDelete/默认值），只留 3 新字段
-- 决策依据：
--   1. refundType=String + 注释 enum 值（同 reason/refundMethod/status 模式，无 DB enum 成本）
--   2 选 A. refund 字段先加，dispatch 集成 defer 到独立 ticket（不写时间戳，当前 null）
--   3. pickupAt/pickedAt 命名（与 Order.pickedAt 一致，不跟 DeliveryTask.pickedUpAt）

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN "refund_type" TEXT NOT NULL DEFAULT 'REFUND_ONLY';
ALTER TABLE "refunds" ADD COLUMN "pickup_at" TIMESTAMP(3);
ALTER TABLE "refunds" ADD COLUMN "picked_at" TIMESTAMP(3);
