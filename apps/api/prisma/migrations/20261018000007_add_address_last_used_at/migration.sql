-- 地址使用追踪（20261018）：Address 加最近使用时间
-- 纯新增可空列，零数据迁移；历史地址 lastUsedAt 为 null（排序时排后），新单生效
ALTER TABLE "addresses" ADD COLUMN "last_used_at" TIMESTAMP(3);
