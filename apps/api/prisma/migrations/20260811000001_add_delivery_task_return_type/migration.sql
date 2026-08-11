-- P14 ④ dispatch 集成：DeliveryTask 加 taskType + refundId（退货退款取件状态机）
-- 走 migrate deploy（per meimart-db-drift，migrate dev 会 reset 整库丢数据）
-- 手写干净 SQL（剔除 diff 中的 drift：备份表/索引命名/FK onDelete/默认值），只留 2 新字段 + unique + FK
-- 决策依据（2026-08-11 用户拍板 spec §七）：
--   1. DELIVERING 打通：新增 startDelivering 方法（return 三步 / delivery 两步跳过 DELIVERING，向后兼容）
--   2. 派单触发：refund APPROVE 同步触发 createTaskForReturn（注入 DispatchService + forwardRef 防循环）
--   3. 派单模式：复用抢单大厅（建任务 PENDING_ASSIGN + WS dispatch:new-task，骑手 acceptTask 抢）
-- 字段语义：
--   task_type='delivery' 默认（向后兼容现有 1:1 订单配送任务），'return' = 退货取件（refund APPROVE+RETURN_REFUND 触发）
--   refund_id 仅 taskType=return 时填，@unique 兜底防重（一个 refund 只能建一个 return task）
--   onDelete SET NULL（refund 极少删，删时保留 task 历史不级联删）

-- AlterTable:加 taskType（default 'delivery' 向后兼容旧任务）+ refundId（nullable，仅 return 任务填）
ALTER TABLE "delivery_tasks" ADD COLUMN "task_type" TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE "delivery_tasks" ADD COLUMN "refund_id" TEXT;

-- Create unique index:refundId @unique（防重，一个 refund 只能建一个 return task；nullable 列多行 null 不冲突）
CREATE UNIQUE INDEX "delivery_tasks_refund_id_key" ON "delivery_tasks"("refund_id");

-- Add foreign key:delivery_tasks.refund_id -> refunds.id（onDelete SET NULL，refund 删时 task 保留历史）
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
