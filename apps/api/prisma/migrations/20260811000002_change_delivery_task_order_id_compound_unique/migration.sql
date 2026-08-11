-- P14 ④ 补：DeliveryTask.orderId @unique → @@unique([orderId, taskType])
-- 原因：原 orderId @unique（1:1 订单）导致 return 任务建不出来（refund 一般发生在 delivery 任务 DELIVERED 后，orderId 仍占着撞 P2002）
-- spec §四·1 提到该约束但 §五 W1 没说怎么解决，本补丁按工程判断改复合 unique，允许同 order 有 delivery + return 各一个
-- 语义更精确：同 order 同 taskType 才唯一（createTaskForOrder 幂等检查改为 findFirst where orderId+taskType=delivery）

-- Drop old single-column unique index
DROP INDEX IF EXISTS "delivery_tasks_order_id_key";

-- Create composite unique index（order_id + task_type）
CREATE UNIQUE INDEX "delivery_tasks_order_id_task_type_key" ON "delivery_tasks"("order_id", "task_type");
