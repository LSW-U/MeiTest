-- 替换品批1（2026-10-29）：替换策略/确认态字段 + 两个新枚举 + OrderEventType 追加 REPLACED
-- 只增不改：全部可空或带默认值新增，既有行与查询不受影响（验收清单批1 第1条）
-- D4：OrderItem 确认态 2 列与 suggestionItemId 1:1 强绑定（null=未触发确认）
-- D9/D13：Order 策略单字段 + SPECIFY 白名单（默认 ALLOW 向后兼容存量单）

-- 1. 新枚举（只增不改）
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');
CREATE TYPE "ReplacementPolicy" AS ENUM ('ALLOW', 'SPECIFY', 'NONE');

-- 2. OrderItem 加 2 列（D4）
ALTER TABLE "order_items" ADD COLUMN "suggestion_status" "SuggestionStatus";
ALTER TABLE "order_items" ADD COLUMN "suggestion_decided_at" TIMESTAMP(3);

-- 3. Order 加 2 列（D9/D13）
ALTER TABLE "orders" ADD COLUMN "replacement_policy" "ReplacementPolicy" NOT NULL DEFAULT 'ALLOW';
ALTER TABLE "orders" ADD COLUMN "allowed_replacement_sku_ids" JSONB;

-- 4. OrderEventType 枚举追加 REPLACED（D8 审计）
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'REPLACED';
