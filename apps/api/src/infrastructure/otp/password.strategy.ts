/**
 * 密码策略（主登录）— 真实实现
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案
 *   - 密码 ≥ 8 位 + 字母 + 数字
 *   - bcrypt hash 存储（OWASP 2023 推荐 cost=12）
 *
 * 设计：不实现 OtpStrategy 接口（密码不需要 sendCode/verifyCode 的"验证码"语义）
 *      业务调用方单独 import passwordStrategy 单例，调 hashPassword/verifyPassword
 *      避免工厂拿到的实例调用时抛错（LSP 违反）
 */
import bcrypt from 'bcryptjs';

/** bcrypt cost（OWASP 2023 推荐 ≥12） */
export const BCRYPT_COST = 12;

/** 密码策略错误码 */
export class PasswordPolicyError extends Error {
  constructor() {
    super('PASSWORD_POLICY: ≥8 位 + 字母 + 数字');
    this.name = 'PasswordPolicyError';
  }
}

export class PasswordStrategy {
  /**
   * 密码哈希（注册 / 改密时用）
   *
   * @param plain 明文密码（≥8 位 + 字母 + 数字）
   * @returns bcrypt hash（cost=12，dev 约 200ms）
   */
  async hashPassword(plain: string): Promise<string> {
    if (plain.length < 8 || !/[a-zA-Z]/.test(plain) || !/\d/.test(plain)) {
      throw new PasswordPolicyError();
    }
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  /**
   * 验证密码（登录时用）
   *
   * @param hash DB 中存的 bcrypt hash（含 cost 信息，不依赖当前 BCRYPT_COST）
   * @param plain 用户输入的明文
   */
  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}

/** 单例（dev hot reload 安全） */
const globalForPassword = globalThis as unknown as { passwordStrategy?: PasswordStrategy };
export const passwordStrategy: PasswordStrategy =
  globalForPassword.passwordStrategy ?? new PasswordStrategy();
if (process.env.NODE_ENV !== 'production') {
  globalForPassword.passwordStrategy = passwordStrategy;
}
