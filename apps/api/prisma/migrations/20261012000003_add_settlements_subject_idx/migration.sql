-- 后端性能清理 批1（方案 v2 §七）：settlements(subject_type, subject_id) 缺失索引
-- 按结算对象取周期列表查询，现有 (subject_type, status) 不含 subject_id 前缀
-- （(period_date, subject_type, subject_id) 唯一索引 subject_type 非前缀不可用）。
-- 单条 CREATE INDEX CONCURRENTLY migration（先例 20260909000002）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "settlements_subject_type_subject_id_idx"
  ON "settlements" ("subject_type", "subject_id");
