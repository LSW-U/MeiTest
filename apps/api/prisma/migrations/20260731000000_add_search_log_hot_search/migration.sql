-- 热搜功能（2026-07-31）：搜索日志明细 + 运营种子词 + HotSearchType enum
-- SearchLog：搜索日志明细（审计 + 零结果词分析；热搜查询走 Redis ZSET，不查本表）
-- HotSearchTerm：运营种子词（PINNED 置顶 / MANUAL 种子 / BLOCKED 屏蔽），冷启动兜底 + 违规词过滤

-- EnumType
CREATE TYPE "HotSearchType" AS ENUM ('PINNED', 'MANUAL', 'BLOCKED');

-- CreateTable: search_logs
CREATE TABLE "search_logs" (
    "id" BIGSERIAL NOT NULL,
    "word" VARCHAR(50) NOT NULL,
    "raw_word" VARCHAR(100) NOT NULL,
    "lang" VARCHAR(8) NOT NULL,
    "user_id" TEXT,
    "result_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_logs_word_lang_idx" ON "search_logs"("word", "lang");
CREATE INDEX "search_logs_created_at_idx" ON "search_logs"("created_at");
CREATE INDEX "search_logs_user_id_created_at_idx" ON "search_logs"("user_id", "created_at");

-- CreateTable: hot_search_terms
CREATE TABLE "hot_search_terms" (
    "id" TEXT NOT NULL,
    "word" VARCHAR(50) NOT NULL,
    "lang" VARCHAR(8) NOT NULL,
    "type" "HotSearchType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hot_search_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hot_search_terms_word_lang_type_key" ON "hot_search_terms"("word", "lang", "type");
