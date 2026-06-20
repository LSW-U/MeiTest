/**
 * OTP 策略抽象（v0.3 决策 + CLAUDE.md §测试阶段 OTP 完整方案）
 *
 * 决策依据：
 * - 密码（主登录）— 真实，bcrypt 哈希
 * - SMS（手机验证）— 测试 stub 固定 123456，W6 切东帝汶本地 Timor Telecom/Telkomcel
 * - 邮箱（找回密码）— 真实，nodemailer + MailHog dev / SendGrid prod
 * - WhatsApp（预留）— stub 123456，W6 申请 Business API
 *
 * mock/stub 实现日志标 [SMS_STUB] / [WA_STUB]
 */

export type OtpChannel = 'PASSWORD' | 'SMS' | 'EMAIL' | 'WHATSAPP';

export type OtpScene = 'REGISTER' | 'LOGIN' | 'RESET_PASSWORD' | 'BIND_PHONE';

export interface OtpSendInput {
  /** 手机号 / 邮箱（密码策略忽略） */
  target: string;
  scene: OtpScene;
}

export interface OtpSendOutput {
  /** 验证码有效期（秒） */
  expireIn: number;
}

export interface OtpVerifyInput {
  target: string;
  /** 密码策略：password；其他：6 位数字验证码 */
  code: string;
  scene: OtpScene;
}

export interface OtpVerifyOutput {
  valid: boolean;
  /** 失败原因（valid=false 时） */
  reason?: 'WRONG_CODE' | 'EXPIRED' | 'RATE_LIMITED' | 'TARGET_NOT_FOUND';
}

export interface OtpStrategy {
  readonly channel: OtpChannel;
  sendCode(input: OtpSendInput): Promise<OtpSendOutput>;
  verifyCode(input: OtpVerifyInput): Promise<OtpVerifyOutput>;
  readonly isMock: boolean;
}
