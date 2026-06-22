/**
 * 邮箱策略（找回密码）— 真实实现
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案
 *   - dev：MailHog（SMTP localhost:1025）抓邮件看
 *   - prod：SendGrid（免费 100 封/天，MVP 够用）
 *   - 验证码 6 位随机数，Redis 存 10 分钟
 */
import nodemailer from 'nodemailer';
import { logger } from "../../shared/logger/logger";
import { randomInt } from 'node:crypto';
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

/** 生成 6 位密码学安全验证码（randomInt 上界 exclusive，[100000, 1000000)） */
function gen6DigitCode(): string {
  return String(randomInt(100_000, 1_000_000));
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

    logger.info({
      msg: '[EMAIL] sendCode',
      email: input.target,
      scene: input.scene,
      // M-5：不输出 code 原文（dev 看 MailHog，prod 看 SendGrid 后台）
      // 显式 SMS_STUB_CODE 时才打印（仅 dev debug）
      ...(process.env.OTP_DEBUG_CODE === '1' ? { codeDebug: code } : {}),
    });
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
    logger.info({ msg: '[EMAIL] verifyCode', email: input.target, scene: input.scene, result: 'PASS' });
    return { valid: true };
  }
}
