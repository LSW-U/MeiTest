-- B8 会员积分：User 加 points 列（$1=1pt，即 payableAmount 100 分 = 1pt）
-- profile 端点实时聚合已成交订单 payableAmount 返回；字段入库为未来 increment 缓存预留
ALTER TABLE "users" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;
