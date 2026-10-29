-- 工单化批2（2026-10-29）：Ticket + TicketEvent 落表（方案v2 D10/D12/D15/D16/D18/D19）
-- 只增不改：全部新建表/枚举/索引，既有表零改动（验收清单批2 第1条）

-- 1. 新枚举（只增不改）
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "TicketType" AS ENUM ('CUSTOMER_UNREACHABLE', 'CUSTOMER_REJECTED', 'ADDRESS_NOT_FOUND', 'TRAFFIC_ACCIDENT', 'OTHER', 'FEEDBACK');

-- 2. 工单主表（D10）
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "ticket_no" VARCHAR(16) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "type" "TicketType" NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "source_id" VARCHAR(64) NOT NULL,
    "first_resp_due" TIMESTAMP(3),
    "resolve_due" TIMESTAMP(3),
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- 3. 工单事件子表（D16）
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "event_type" VARCHAR(32) NOT NULL,
    "operator_type" VARCHAR(16) NOT NULL,
    "operator_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- 4. 唯一约束 + 索引
-- D19 幂等：同一来源（DELIVERY_ISSUE + taskId）只建一票
CREATE UNIQUE INDEX "tickets_source_type_source_id_key" ON "tickets"("source_type", "source_id");
CREATE UNIQUE INDEX "tickets_ticket_no_key" ON "tickets"("ticket_no");
-- 用户端「我的工单」列表分页
CREATE INDEX "tickets_user_id_created_at_idx" ON "tickets"("user_id", "created_at");
-- 批3 admin 工作台状态筛选预留
CREATE INDEX "tickets_status_created_at_idx" ON "tickets"("status", "created_at");
-- D16 时间线分页
CREATE INDEX "ticket_events_ticket_id_created_at_idx" ON "ticket_events"("ticket_id", "created_at");

-- 5. 外键
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
