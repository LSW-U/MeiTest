/**
 * 统一手机号入口 schema（W7-ext-H）
 *
 * 3 端点：sms/send + sms/verify + register/complete
 * 仅 BUYER（消费者 App）
 */
import { z } from 'zod';
import { Id, PhoneE164 } from './common';

/** 发送验证码请求 */
export const UnifiedSendSmsRequest = z.object({
  phone: PhoneE164, // 批A R9：归一化（空格/横线/00前缀）→ E.164
  deviceId: z.string().optional(),
  // 批A2-2 决策7/8：图形验证码票据（SMS_CAPTCHA_REQUIRED=true 时必传；dev 开关关可省）
  captchaId: z.string().min(8).max(64).optional(),
  captchaText: z.string().min(1).max(8).optional(),
});

/** 批A2-2：图形验证码签发响应（GET /common/auth/captcha，60s 一次性票据） */
export const UnifiedCaptchaResponse = z.object({
  captchaId: z.string().min(8).max(64),
  svg: z.string(), // SVG 文本，前端 innerHTML 直接渲染
  expireIn: z.number().int(),
});

/** 发送验证码响应（202，统一，不暴露 registered） */
export const UnifiedSendSmsResponse = z.object({
  challengeId: z.string().uuid(),
  expireIn: z.number().int(),
});

/** 验证码校验请求 */
export const UnifiedVerifySmsRequest = z.object({
  phone: PhoneE164, // 批A R9：归一化 → E.164
  code: z.string().length(6),
  challengeId: z.string().uuid(),
});

/** 验证码校验响应（200，action 分流） */
export const UnifiedVerifySmsResponse = z.object({
  action: z.enum(['LOGIN', 'REGISTER', 'BLOCKED']),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  accessExpiresAt: z.number().int().optional(),
  refreshExpiresAt: z.number().int().optional(),
  user: z
    .object({
      id: Id,
      role: z.string(),
      phone: z.string(),
    })
    .optional(),
  registrationTicket: z.string().optional(),
  expireIn: z.number().int().optional(),
});

/** 完成注册请求 */
export const UnifiedCompleteRegisterRequest = z.object({
  registrationTicket: z.string().min(10),
  agreedToTerms: z.literal(true),
  challengeId: z.string().uuid(),
  deviceId: z.string().optional(),
});

/** 完成注册响应 */
export const UnifiedCompleteRegisterResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number().int(),
  refreshExpiresAt: z.number().int(),
  user: z.object({
    id: Id,
    role: z.string(),
    phone: z.string(),
  }),
});
