-- 后端性能清理 批1（方案 v2 §七）：withdrawal_requests(requester_type, requester_id) 缺失索引
-- 按申请方取提现列表查询，现有 (requester_type, status) 不含 requester_id 前缀 → 全表扫。
-- 单条 CREATE INDEX CONCURRENTLY migration（先例 20260909000002）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "withdrawal_requests_requester_type_requester_id_idx"
  ON "withdrawal_requests" ("requester_type", "requester_id");
