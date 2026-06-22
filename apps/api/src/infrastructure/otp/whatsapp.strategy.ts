/**
 * WhatsApp 策略（预留）— Stub 实现
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案 + 本地化清单 §四
 *   - 测试阶段：固定验证码 123456，日志标 [WA_STUB]
 *   - W6-W7：拿到主体后申请 WhatsApp Business API（接口不变）
 */
import { redis } from '../../shared/cache';
import { logger } from "../../shared/logger/logger";
import type {
  OtpStrategy,
  OtpSendInput,
  OtpSendOutput,
  OtpVerifyInput,
  OtpVerifyOutput,
} from './otp-strategy';

const CODE_TTL_SECONDS = 5 * 60;
const KEY_PREFIX = 'otp:wa:';

export class WhatsappStrategy implements OtpStrategy {
  readonly channel = 'WHATSAPP' as const;
  readonly isMock = true;

  async sendCode(input: OtpSendInput): Promise<OtpSendOutput> {
    const stubCode = process.env.WA_STUB_CODE ?? '123456';
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    await redis.set(key, stubCode, 'EX', CODE_TTL_SECONDS);

    logger.info({
      msg: '[WA_STUB] sendCode',
      phone: input.target,
      scene: input.scene,
      // M-5：不输出 code 原文。OTP_DEBUG_CODE=1 时显式打开（仅 dev debug）
      ...(process.env.OTP_DEBUG_CODE === '1' ? { codeDebug: stubCode } : {}),
      note: 'stub code in Redis (WA_STUB_CODE env or default 123456)',
    });
    return { expireIn: CODE_TTL_SECONDS };
  }

  async verifyCode(input: OtpVerifyInput): Promise<OtpVerifyOutput> {
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    const stored = await redis.get(key);

    if (!stored) return { valid: false, reason: 'EXPIRED' };
    if (stored !== input.code) return { valid: false, reason: 'WRONG_CODE' };

    await redis.del(key);
    logger.info({ msg: '[WA_STUB] verifyCode', phone: input.target, scene: input.scene, result: 'PASS' });
    return { valid: true };
  }
}
