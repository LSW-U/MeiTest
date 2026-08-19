-- P22 F1：用户反馈表（2026-08-19）
-- 与 Review（商品评价）/ RiderReview（骑手评价）语义不同：反馈不挂订单、无需审核，仅落库供后台查看。
-- content 为单语言纯文本（用户原话不翻译），非 i18n JSON。
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contact" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedbacks_user_id_created_at_idx" ON "feedbacks"("user_id", "created_at");
CREATE INDEX "feedbacks_category_created_at_idx" ON "feedbacks"("category", "created_at");

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
