/**
 * 密码策略（主登录）— 真实实现
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案
 *   - 密码 ≥ 8 位 + 字母 + 数字
 *   - bcrypt hash 存储（10 轮 cost）
 *   - sendCode 在密码策略中无意义（密码不需要发送验证码）
 *   - verifyCode 用 bcrypt.compare
 */
import bcrypt from 'bcryptjs';
import type {
  OtpStrategy,
  OtpSendInput,
  OtpSendOutput,
  OtpVerifyInput,
  OtpVerifyOutput,
} from './otp-strategy';

export class PasswordStrategy implements OtpStrategy {
  readonly channel = 'PASSWORD' as const;
  readonly isMock = false;

  /**
   * 密码策略的 "sendCode" 实际是 hash 操作（注册 / 改密时用）
   *
   * @returns hash 后的密码（调用方负责存 DB）
   */
  async hashPassword(plain: string): Promise<string> {
    if (plain.length < 8 || !/[a-zA-Z]/.test(plain) || !/\d/.test(plain)) {
      throw new Error('PASSWORD_POLICY: ≥8 位 + 字母 + 数字');
    }
    return bcrypt.hash(plain, 10);
  }

  async sendCode(_input: OtpSendInput): Promise<OtpSendOutput> {
    throw new Error('PASSWORD_STRATEGY_NO_SEND_CODE: 密码策略不需要发送验证码');
  }

  /**
   * @param input.code 明文密码
   * @param input.target 此字段在密码策略中是 hash，但接口要求 target 类型统一；
   *                     实际 hash 应作为额外参数传入，调用方用 verifyPassword(hash, plain)
   */
  async verifyCode(input: OtpVerifyInput): Promise<OtpVerifyOutput> {
    // 密码策略的 verifyCode 不通过 target 拿 hash（hash 在 DB）
    // 调用方应改用 verifyPassword 方法
    throw new Error(
      `PASSWORD_STRATEGY_USE_VERIFY_PASSWORD: 不要用 verifyCode，用 verifyPassword(hash, plain)。input=${JSON.stringify(input)}`,
    );
  }

  /**
   * 验证密码（业务调用方用）
   *
   * @param hash DB 中存的 bcrypt hash
   * @param plain 用户输入的明文
   */
  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
