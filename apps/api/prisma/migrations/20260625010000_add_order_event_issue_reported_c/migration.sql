-- Flow C W3 (P1 修复 S5): 给 OrderEventType 加 ISSUE_REPORTED 用于 dispatch 异常上报
-- 决策依据：W3-C 代码审查报告 S5 项（reportIssue 需要写 OrderEvent 给客服查得到）

ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'ISSUE_REPORTED';
