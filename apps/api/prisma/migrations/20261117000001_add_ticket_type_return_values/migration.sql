-- F3 已取消订单出口 + §4 死线超时返仓（20261117 立项 D1 拍板）
-- TicketType 新增两返仓值（与 dispatch ReportIssueRequest reason 同步；只能新增，不改不删）

ALTER TYPE "TicketType" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLED';
ALTER TYPE "TicketType" ADD VALUE IF NOT EXISTS 'DEADLINE_OVERDUE_RETURN';
