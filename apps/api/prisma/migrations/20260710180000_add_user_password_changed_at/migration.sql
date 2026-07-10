-- W7-fix: 加 User.passwordChangedAt 字段，用于 refresh 端点检查 token.iat < passwordChangedAt 拒绝旧 token
-- 修复审查报告 P0 #2：resetPassword 不失效旧 refreshToken

ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);
