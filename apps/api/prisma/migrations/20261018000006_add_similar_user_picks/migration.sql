-- 批6 协同过滤（2026-10-18）：similar_user_picks 物化表
-- A9「和你相似的顾客还买了」+ B7 全量千人千面的读路径数据源（P6-2：读物化表不现算）。
-- 由 BullMQ 离线任务全量重算写入（delete + batch insert，重算频率 G5 可配）。

CREATE TABLE "similar_user_picks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    -- 相似度得分（邻居共现权重聚合，0-1 归一），业务排序语义非精确概率
    "score" DOUBLE PRECISION NOT NULL,
    -- 证据字段（P6-1 可解释可回溯）：贡献该推荐的相似邻居用户数
    "source_count" INTEGER NOT NULL,
    -- 证据字段：top 邻居的最低相似度分（邻居质量下界）
    "min_score" DOUBLE PRECISION NOT NULL,
    -- 本行计算时间（物化批次时间戳，回溯用）
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "similar_user_picks_pkey" PRIMARY KEY ("id")
);

-- 读路径主查询：按用户取 top K 推荐（score desc）
CREATE INDEX "similar_user_picks_user_id_score_idx" ON "similar_user_picks"("user_id", "score" DESC);
-- B7 per-user 信号查询的 user_id 过滤（getSimilarSignalMap WHERE user_id = ? AND product_id IN）
CREATE INDEX "similar_user_picks_computed_at_idx" ON "similar_user_picks"("computed_at");
-- P3-3：B7 信号/A9 候选按 product_id 反查（重算外读路径的 IN 查询索引）
CREATE INDEX "similar_user_picks_product_id_idx" ON "similar_user_picks"("product_id");
