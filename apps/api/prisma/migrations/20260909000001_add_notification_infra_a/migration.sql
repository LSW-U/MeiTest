-- 批A：通知基础设施（DeviceToken / NotificationBatch / Notification.batchId / NotificationType 扩枚举）
-- 手写 migration（migrate diff 产出后手剔既有 drift），勿用 migrate dev（memory: db drift 会要求 reset）

-- AlterEnum（PG16 支持单 migration 多值 ADD VALUE）
ALTER TYPE "NotificationType" ADD VALUE 'RIDER_TASK';
ALTER TYPE "NotificationType" ADD VALUE 'WALLET';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "batch_id" TEXT;

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_batches" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "user_ids" JSONB,
    "total_recipients" INTEGER NOT NULL,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_status_idx" ON "device_tokens"("user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_batch_id_is_read_idx" ON "notifications"("batch_id", "is_read");
