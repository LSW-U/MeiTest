-- Flow C W3 (P2 修复 V2-S5): DeviceType 枚举加 SYSTEM
-- 决策依据：W3-C v2 审查报告 V2-S5（admin_web 表达"系统操作"语义混淆）
-- 用途：BullMQ worker / cron / 内部回调触发的 OrderEvent 标 SYSTEM
--       区分真实 admin 操作和系统自动操作

ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'SYSTEM';
