-- 配送费距离计费（2026-08-27，批次1）
-- 决策依据：《02-配送费计算公式.md》Q1-Q11 已定稿
--   deliveryFee = baseFee + max(0, distanceKm - freeKm) × perKmFee
--
-- 灰度安全网：per_km_fee 默认 0 → 公式退化为 baseFee，行为与现状完全一致
-- free_km 默认 2（base 覆盖起步距离）
-- orders.delivery_fee_breakdown：计价快照 {baseFee, distanceFee, distanceKm, perKmFee, freeKm}

-- warehouses：每公里加价 + 起步距离
ALTER TABLE "warehouses" ADD COLUMN "per_km_fee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "warehouses" ADD COLUMN "free_km" DECIMAL(10,2) NOT NULL DEFAULT 2;

-- orders：配送费计价快照（骑手端明细展示 + 灰度期校准数据源）
ALTER TABLE "orders" ADD COLUMN "delivery_fee_breakdown" JSONB;
