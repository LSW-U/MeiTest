/**
 * 统一手机号入口 schema（W7-ext-H）
 *
 * 3 端点：sms/send + sms/verify + register/complete
 * 仅 BUYER（消费者 App）
 */
import { z } from 'zod';
import { Id } from './common';

/** 发送验证码请求 */
export const UnifiedSendSmsRequest = z.object({
  phone: z.string().min(8).max(20),
  deviceId: z.string().optional(),
});

/** 发送验证码响应（202，统一，不暴露 registered） */
export const UnifiedSendSmsResponse = z.object({
  challengeId: z.string().uuid(),
  expireIn: z.number().int(),
});

/** 验证码校验请求 */
export const UnifiedVerifySmsRequest = z.object({
  phone: z.string().min(8).max(20),
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
