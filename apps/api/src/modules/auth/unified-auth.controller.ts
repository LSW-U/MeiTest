/**
 * Unified Auth Controller - 统一手机号登录/注册（W7-ext-H）
 *
 * 3 个新端点（并行，不改旧 auth 端点）：
 *   POST /api/v1/common/auth/sms/send        202 + challengeId（统一，防枚举）
 *   POST /api/v1/common/auth/sms/verify       200 + action 分流（LOGIN/REGISTER/BLOCKED）
 *   POST /api/v1/common/auth/register/complete 200 + token（ticket 原子消费 + DB 事务）
 *
 * 仅 BUYER（消费者 App）。SELLER/RIDER/ADMIN 不通过此入口。
 */
import { Controller, Post, Body, Inject, HttpCode, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { UnifiedAuthService } from './unified-auth.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Public } from '../../shared/decorators/public.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';

const SendSmsRequest = z.object({
  phone: z.string().min(8).max(20),
  deviceId: z.string().optional(),
});

const VerifySmsRequest = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().length(6),
  challengeId: z.string().uuid(),
});

const CompleteRegisterRequest = z.object({
  registrationTicket: z.string().min(10),
  agreedToTerms: z.literal(true),
  challengeId: z.string().uuid(),
  deviceId: z.string().optional(),
});

@Controller('api/v1/common/auth')
export class UnifiedAuthController {
  constructor(@Inject(UnifiedAuthService) private readonly unified: UnifiedAuthService) {}

  /**
   * 发送验证码（统一 202，无论手机号是否已注册）
   * 返回 challengeId（关联 OTP，verify 时传）
   */
  @Public()
  @Audit({ resource: 'Auth', skip: true })
  @RateLimit(
    { key: 'sms:phone:${body.phone}:60s', limit: 1, window: 60 },
    { key: 'sms:phone:${body.phone}:1h', limit: 5, window: 3600 },
    { key: 'sms:phone:${body.phone}:24h', limit: 10, window: 86400 },
    { key: 'sms:ip:${ip}:1h', limit: 20, window: 3600 },
  )
  @Post('sms/send')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendSms(
    @Body(new ZodValidationPipe(SendSmsRequest)) body: { phone: string; deviceId?: string },
  ) {
    const data = await this.unified.sendSmsCodeWithChallenge(body.phone, body.deviceId);
    return { success: true as const, data };
  }

  /**
   * 验证码校验 + 分流（LOGIN / REGISTER / BLOCKED）
   * 不暴露手机号是否已注册（action 内含，但响应结构统一）
   */
  @Public()
  @Audit({ resource: 'Auth', maskFields: ['code'] })
  @RateLimit(
    { key: 'verify:phone:${body.phone}:1h', limit: 10, window: 3600 },
    { key: 'verify:ip:${ip}:1h', limit: 30, window: 3600 },
  )
  @Post('sms/verify')
  @HttpCode(HttpStatus.OK)
  async verifySms(
    @Body(new ZodValidationPipe(VerifySmsRequest))
    body: { phone: string; code: string; challengeId: string },
  ) {
    const data = await this.unified.verifyAndDispatch(body.phone, body.code, body.challengeId);
    return { success: true as const, data };
  }

  /**
   * 完成注册（原子消费 ticket + DB 事务创建 BUYER）
   * 必须同意条款（agreedToTerms: true）
   */
  @Public()
  @Audit({ resource: 'Auth' })
  @RateLimit({ key: 'register:ip:${ip}:1h', limit: 5, window: 3600 })
  @Post('register/complete')
  @HttpCode(HttpStatus.OK)
  async completeRegister(
    @Body(new ZodValidationPipe(CompleteRegisterRequest))
    body: {
      registrationTicket: string;
      agreedToTerms: true;
      challengeId: string;
      deviceId?: string;
    },
  ) {
    const data = await this.unified.completeRegistration(body);
    return { success: true as const, data };
  }
}
