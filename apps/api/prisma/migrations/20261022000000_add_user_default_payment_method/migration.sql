-- 默认支付方式（方案乙批1 v3 20261022）：User 加偏好列，单列可空
-- null=未设置（D3）；String 列不加 DB enum（D1/D1b），应用层 isPaymentMethodOrderable 校验
-- 只增不改：既有行不受影响（可空，无默认值）
ALTER TABLE "users" ADD COLUMN "default_payment_method" TEXT;
