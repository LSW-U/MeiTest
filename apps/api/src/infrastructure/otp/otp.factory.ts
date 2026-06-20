/**
 * OTP 策略工厂（按 channel 选 strategy）
 *
 * 用法：
 *   import { getOtpStrategy } from '@/infrastructure/otp';
 *   const sms = getOtpStrategy('SMS');
 *   await sms.sendCode({ target: '+670...', scene: 'REGISTER' });
 *   const r = await sms.verifyCode({ target: '+670...', code: '123456', scene: 'REGISTER' });
 *
 * 密码策略单独 export（不实现 OtpStrategy，业务调用方直接 import）：
 *   import { passwordStrategy } from '@/infrastructure/otp/password.strategy';
 *   await passwordStrategy.hashPassword(plain);
 *   await passwordStrategy.verifyPassword(hash, plain);
 */
import type { OtpChannel, OtpStrategy } from './otp-strategy';
import { SmsStrategy } from './sms.strategy';
import { EmailStrategy } from './email.strategy';
import { WhatsappStrategy } from './whatsapp.strategy';

const STRATEGIES: Record<OtpChannel, OtpStrategy> = {
  SMS: new SmsStrategy(),
  EMAIL: new EmailStrategy(),
  WHATSAPP: new WhatsappStrategy(),
};

export function getOtpStrategy(channel: OtpChannel): OtpStrategy {
  const strategy = STRATEGIES[channel];
  if (!strategy) throw new Error(`UNSUPPORTED_OTP_CHANNEL: ${channel}`);
  return strategy;
}

/** W7 上线前 checklist：检查 stub 残留 */
export function listMockOtpStrategies(): OtpStrategy[] {
  return Object.values(STRATEGIES).filter((s) => s.isMock);
}

export * from './otp-strategy';
