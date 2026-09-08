-- 批B 支付枚举补位（微信支付预留 2026-09-08，方案V2 §3.2 第 1 条）
-- PaymentMethod 枚举加 3 值：WECHAT_GLOBAL / ALIPAY_CN / LOCAL_PSP
-- 枚举加值向后兼容，无数据回填；存量行不受影响

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'WECHAT_GLOBAL';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ALIPAY_CN';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'LOCAL_PSP';
