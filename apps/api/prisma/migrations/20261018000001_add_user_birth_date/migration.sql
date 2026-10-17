-- G8（客户画像批1 2026-10-18）：User 生日字段，单列可空
-- C6 生日营销（批4）只消费不补表；既有行不受影响（可空，无默认值）
ALTER TABLE "users" ADD COLUMN "birth_date" TIMESTAMP(3);
