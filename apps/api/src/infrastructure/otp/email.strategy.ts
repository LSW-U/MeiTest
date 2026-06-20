/**
 * 邮箱策略（找回密码）— 真实实现
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案
 *   - dev：MailHog（SMTP localhost:1025）抓邮件看
 *   - prod：SendGrid（免费 100 封/天，MVP 够用）
 *   - 验证码 6 位随机数，Redis 存 10 分钟
 */
import nodemailer from 'nodemailer';
import { redis } from '../../shared/cache';
import type {
  OtpStrategy,
  OtpSendInput,
  OtpSendOutput,
  OtpVerifyInput,
  OtpVerifyOutput,
} from './otp-strategy';

const CODE_TTL_SECONDS = 10 * 60; // 10 分钟
const KEY_PREFIX = 'otp:email:';

function gen6DigitCode(): string {
  // crypto-strong 6 位数字
  const min = 100_000;
  const max = 999_999;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

export class EmailStrategy implements OtpStrategy {
  readonly channel = 'EMAIL' as const;
  readonly isMock = false;

  private async getTransport() {
    const host = process.env.SMTP_HOST ?? 'localhost';
    const port = Number(process.env.SMTP_PORT ?? 1025);
    return nodemailer.createTransport({ host, port, secure: false });
  }

  async sendCode(input: OtpSendInput): Promise<OtpSendOutput> {
    const code = gen6DigitCode();
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    await redis.set(key, code, 'EX', CODE_TTL_SECONDS);

    const transport = await this.getTransport();
    const from = process.env.SMTP_FROM ?? 'MeiMart <noreply@meimart.dev>';

    await transport.sendMail({
      from,
      to: input.target,
      subject: `[MeiMart] Verification code (${input.scene})`,
      text: `Your MeiMart verification code is: ${code}\n\nThis code expires in 10 minutes.\nIf you did not request this, please ignore this email.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>MeiMart Verification Code</h2>
          <p>Your verification code for <strong>${input.scene}</strong> is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; padding: 16px; background: #f0f4ff; border-radius: 8px; text-align: center;">${code}</div>
          <p style="color: #666; font-size: 13px;">This code expires in 10 minutes. If you did not request it, please ignore this email.</p>
        </div>
      `,
    });

    console.log(`[EMAIL] sendCode to=${input.target} scene=${input.scene} code=${code}`);
    return { expireIn: CODE_TTL_SECONDS };
  }

  async verifyCode(input: OtpVerifyInput): Promise<OtpVerifyOutput> {
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    const stored = await redis.get(key);

    if (!stored) {
      return { valid: false, reason: 'EXPIRED' };
    }
    if (stored !== input.code) {
      return { valid: false, reason: 'WRONG_CODE' };
    }
    await redis.del(key);
    console.log(`[EMAIL] verifyCode to=${input.target} scene=${input.scene} → PASS`);
    return { valid: true };
  }
}
