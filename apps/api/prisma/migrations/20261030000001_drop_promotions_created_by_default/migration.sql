-- 技术债收尾批2（D4 2026-10-30）：promotions.created_by 校准
-- 迁移 20260713210000 建列时误加 DEFAULT ''，schema.prisma 无 @default，diff 恒报漂移。
-- 安全性：全仓唯一创建路径 promotion.controller.ts:104 恒传 createdBy: req.user.sub
--   （service:185/199 落库），seed 无 promotion 创建 → DROP DEFAULT 无 NULL 风险。
ALTER TABLE "promotions" ALTER COLUMN "created_by" DROP DEFAULT;
