-- W7-ext-H-unified-auth: User 加 agreedTermsVersion + password 改 nullable
-- 统一手机号入口 complete 端点：SMS 注册无密码 + 记录条款版本

ALTER TABLE "users" ADD COLUMN "agreed_terms_version" TEXT;

-- password 改 nullable（SMS 注册用户无密码，loginWithPassword 检查 null 引导用 SMS 登录）
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;
