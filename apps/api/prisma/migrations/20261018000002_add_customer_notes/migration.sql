-- D6（客户画像批1 2026-10-18）：客户内部标记/备注表
-- 通用 customer 维度（与 rider_deposits.admin_note 专用字段无关，勿撞名）
-- 写操作审计由 AuditInterceptor 覆盖（POST/PATCH/DELETE），表本身无审计列
-- id 为 uuid（与 users.id TEXT uuid 值对齐，Prisma @default(uuid()) 应用层生成）
CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notes_user_id_created_at_idx" ON "customer_notes"("user_id", "created_at");

ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
