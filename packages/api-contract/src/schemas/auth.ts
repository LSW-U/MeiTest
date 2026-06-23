/**
 * 认证模块 schema
 *
 * 决策依据：
 * - 契约 v0.3 决策 C：JWT payload 删 clientType，加 deviceType + jti
 * - 契约 v0.3 决策 E：Token 分端 TTL（client 30d / rider 12h / admin 2h，refresh 60d）
 * - 契约 v0.3 决策 F：logout 必传 refreshToken，服务端黑名单
 * - 契约 v0.3 冲突 11：register smsCode 可选，手机号未验证可注册但下单受限
 * - CLAUDE.md §视角切换：role 5 个真实角色（super_admin/customer/rider/warehouse_staff/customer_service）
 * - CLAUDE.md §视角切换：deviceType 3 个值（client_app/rider_app/admin_web），前端 App 配置写死
 */
import { z } from 'zod';
import { Id } from './common';

/** 用户角色（5 个真实角色） */
export const Role = z.enum([
  'super_admin',
  'customer',
  'rider',
  'warehouse_staff',
  'customer_service',
]);
export type Role = z.infer<typeof Role>;

/** 设备类型（3 端，前端 App 配置写死，服务端用于审计 + token 策略） */
export const DeviceType = z.enum(['client_app', 'rider_app', 'admin_web']);
export type DeviceType = z.infer<typeof DeviceType>;

/** 后台视角（仅审计字段，后端 RBAC 不感知） */
export const Perspective = z.enum([
  'platform',
  'merchant',
  'warehouse',
  'support',
  'rider-mgmt',
]);
export type Perspective = z.infer<typeof Perspective>;

/** JWT payload（无 clientType） */
export const JwtPayload = z.object({
  sub: Id,
  role: Role,
  deviceType: DeviceType,
  iat: z.number().int(),
  exp: z.number().int(),
  jti: Id,
});

/** 密码登录请求（deviceType 由前端 App 配置写死，不进 payload） */
export const LoginRequest = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

/** 登录响应 data */
export const LoginResponseData = z.object({
  user: z.object({
    id: Id,
    role: Role,
    phone: z.string().nullable(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
});

/** 注册请求（smsCode 可选，W6 接真实 SMS 后强制；email optional 走 W 流程密码+SMS 主路径） */
export const RegisterRequest = z
  .object({
    phone: z.string().min(1),
    email: z.string().email().optional(),
    password: z
      .string()
      .min(8, 'PASSWORD_TOO_SHORT')
      .regex(/[a-zA-Z]/, 'PASSWORD_NEED_LETTER')
      .regex(/\d/, 'PASSWORD_NEED_DIGIT'),
    name: z.string().optional(),
    smsCode: z.string().optional(),
  })
  .refine((v) => v.password.length >= 8 && /[a-zA-Z]/.test(v.password) && /\d/.test(v.password), {
    message: 'PASSWORD_POLICY: ≥8 位 + 字母 + 数字',
  });

/**
 * 密码登录请求（W 流程新增，对应 POST /api/v1/common/auth/login-password）
 *
 * deviceType 不在请求体（按 user.role 推断：customer→client_app, rider→rider_app, 其他→admin_web）
 */
export const LoginPasswordRequest = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
});

/** SMS 验证码登录请求（对应 POST /api/v1/common/auth/login-sms） */
export const LoginSmsRequest = z.object({
  phone: z.string().min(1),
  smsCode: z.string().min(1),
});

/** 简化版发 SMS 验证码请求（不带 scene，默认 LOGIN；对应 POST /api/v1/common/auth/sms-code） */
export const SendSmsCodeRequest = z.object({
  phone: z.string().min(1),
  scene: z.enum(['REGISTER', 'LOGIN', 'RESET_PASSWORD']).default('LOGIN'),
});

/** SMS 找回密码请求（对应 POST /api/v1/common/auth/password-reset） */
export const PasswordResetRequest = z.object({
  phone: z.string().min(1),
  smsCode: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'PASSWORD_TOO_SHORT')
    .regex(/[a-zA-Z]/, 'PASSWORD_NEED_LETTER')
    .regex(/\d/, 'PASSWORD_NEED_DIGIT'),
});

/** 刷新 token 请求 */
export const RefreshRequest = z.object({
  refreshToken: z.string().min(1),
});

/** 刷新 token 响应 data */
export const RefreshResponseData = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

/** logout 请求（必传 refreshToken，服务端加 Redis 黑名单） */
export const LogoutRequest = z.object({
  refreshToken: z.string().min(1),
});

/** 发送 SMS 验证码请求（v0.3 保留 stub 实现） */
export const SendSmsRequest = z.object({
  phone: z.string().min(1),
  type: z.enum(['REGISTER', 'LOGIN', 'RESET_PASSWORD']),
});

/** 发送 SMS 响应 data */
export const SendSmsResponseData = z.object({
  expireIn: z.number().int().positive(),
});

/** 重置密码请求（邮箱 + 验证码 + 新密码） */
export const ResetPasswordRequest = z.object({
  email: z.string().email(),
  code: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/[a-zA-Z]/)
    .regex(/\d/),
});
