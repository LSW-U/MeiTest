-- 缺货履约闭环批3（2026-10-24）：Refund 异议入口两列（D9 用户拍板形态：加列 + dispute 端点）
-- 只增不改：全部可空新增，既有行与查询不受影响。
-- 语义：system 通路（reviewedBy='SYSTEM'）自动退款后，用户可提异议一次 → 转人工复审；
-- disputedAt 非空 = 已异议（人工复审队列可见），disputeNote = 用户异议说明（≤500）。
ALTER TABLE "refunds" ADD COLUMN "disputed_at" TIMESTAMP(3);
ALTER TABLE "refunds" ADD COLUMN "dispute_note" TEXT;
