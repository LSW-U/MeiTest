-- P22 F3 修复：feedbacks.category 加 CHECK 约束（2026-08-25）
-- 背景：原 migration（20260819000001_add_feedback_table）建表时 category TEXT NOT NULL 无枚举约束，
--       允许任意字符串落库（绕过 zod 层即脏数据）。rider tier 表已有 CHECK 先例。
-- 对齐：值域与 api-contract FeedbackCategory z.enum 完全一致：feature/product/order/payment/shipping/other
-- 后缀 _c：本仓 C 流程产出的 migration（W2-COLLABORATION §3 命名规范）。
-- 注：若历史数据存在非法 category 值，本 ALTER 会失败 → 需先清理脏数据再 apply（见 failure_mode）。
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_category_check"
  CHECK ("category" IN ('feature', 'product', 'order', 'payment', 'shipping', 'other'));
