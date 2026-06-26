-- Flow C W3 (P2 修复 V2-S7): RiderProfile.reviewedById 加 FK 约束
-- 决策依据：W3-C v2 审查报告 V2-S7（reviewed_by_id 缺 FK，admin 硬删留悬空指针）
-- 策略：ON DELETE SET NULL（admin 离职清理账号时，被审核的骑手记录保留，审核人置 null）

ALTER TABLE "rider_profiles"
  ADD CONSTRAINT "fk_rider_profiles_reviewed_by_id"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL;
