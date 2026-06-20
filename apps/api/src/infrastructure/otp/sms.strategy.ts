/**
 * SMS 策略（手机验证）— Stub 实现
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案 + 本地化清单 §四
 *   - 测试阶段：固定验证码 123456，日志标 [SMS_STUB]
 *   - Redis 存验证码 5 分钟，verify 时校验
 *   - W6 切东帝汶本地 Timor Telecom/Telkomcel（接口不变）
 *
 * 注意：未配置 SMS_STUB_CODE 时所有码都验证为 123456；配置后只接受配置值
 */
import { redis } from '../../shared/cache';
import type {
  OtpStrategy,
  OtpSendInput,
  OtpSendOutput,
  OtpVerifyInput,
  OtpVerifyOutput,
} from './otp-strategy';

const STUB_TAG = '[SMS_STUB]';
const CODE_TTL_SECONDS = 5 * 60; // 5 分钟
const KEY_PREFIX = 'otp:sms:';

export class SmsStrategy implements OtpStrategy {
  readonly channel = 'SMS' as const;
  readonly isMock = true;

  async sendCode(input: OtpSendInput): Promise<OtpSendOutput> {
    const stubCode = process.env.SMS_STUB_CODE ?? '123456';
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    await redis.set(key, stubCode, 'EX', CODE_TTL_SECONDS);

    console.log(
      `${STUB_TAG} sendCode target=${input.target} scene=${input.scene} code=${stubCode} (stub)`,
    );
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

    // 验证成功后删除（一次性）
    await redis.del(key);
    console.log(`${STUB_TAG} verifyCode target=${input.target} scene=${input.scene} → PASS`);
    return { valid: true };
  }
}
