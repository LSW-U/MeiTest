-- P11 ETA：DeliveryTask 加预估送达时间列
-- nullable，旧任务为 null（前端降级 etaPlaceholder）；新任务由 dispatch.service.ts createTaskForOrder 写入 now + DEFAULT_ETA_MINUTES
ALTER TABLE "delivery_tasks" ADD COLUMN "estimated_arrival" TIMESTAMP(3);
