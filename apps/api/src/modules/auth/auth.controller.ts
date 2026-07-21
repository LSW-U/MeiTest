/**
 * 正式 Auth Controller（密码 + SMS 登录注册）
 *
 * 决策依据：
 * - 契约 v0.3 + W2-W 流程任务（2026-06-24）
 * - W1 已有 MockLoginController（dev/staging 用），本 controller 是正式生产端点
 * - 路径全在 /api/v1/common/auth/*（DeviceTypeGuard 对 common/* 不限制，登录前没 device token）
 * - deviceType 由服务端按 user.role 推断，前端请求体不传 deviceType（更安全）
 *
 * endpoints：
 *   - POST /login-password  {phone, password} → {user, accessToken, refreshToken}
 *   - POST /login-sms       {phone, smsCode}  → {user, accessToken, refreshToken}
 *   - POST /register        {phone, password, email?, name?, smsCode} → {user, accessToken, refreshToken}
 *   - POST /sms-code        {phone, scene?}   → {expireIn}
 *   - POST /password-reset  {phone, smsCode, newPassword} → {}
 *   - POST /refresh         {refreshToken}    → {accessToken, refreshToken}
 *   - POST /logout          {refreshToken}    → {}
 *
 * manifest §4 报备：扩 W1 完成的 auth 模块（auth.service.ts 加业务方法 + 新增 auth.controller.ts）
 */
import { Controller, Post, Body, Inject, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import {
  LoginPasswordRequest,
  LoginSmsRequest,
  RegisterRequest,
  SendSmsCodeRequest,
  PasswordResetRequest,
  RefreshRequest,
  LogoutRequest,
} from '@meimart/api-contract';
import type { OtpScene } from '../../infrastructure/otp/otp-strategy';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Public } from '../../shared/decorators/public.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';
import { db } from '../../shared/db';

@Controller('api/v1/common/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** 密码登录 */
  @Public()
  @Audit({ resource: 'User', maskFields: ['password'] })
  @RateLimit(
    { key: 'login:ip:${ip}', limit: 10, window: 60 },
    { key: 'login:phone:${body.phone}', limit: 5, window: 60 },
  )
  @Post('login-password')
  @HttpCode(HttpStatus.OK)
  async loginPassword(@Body(new ZodValidationPipe(LoginPasswordRequest)) body: { phone: string; password: string }) {
    const result = await this.auth.loginWithPassword(body.phone, body.password);
    return {
      success: true,
      data: {
        userId: result.userId,
        role: result.role,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        accessExpiresAt: result.accessExpiresAt,
        refreshExpiresAt: result.refreshExpiresAt,
      },
    };
  }

  /** SMS 验证码登录（不存在自动注册） */
  @Public()
  @Audit({ resource: 'User' })
  @RateLimit(
    { key: 'login:ip:${ip}', limit: 10, window: 60 },
    { key: 'login:phone:${body.phone}', limit: 5, window: 60 },
  )
  @Post('login-sms')
  @HttpCode(HttpStatus.OK)
  async loginSms(@Body(new ZodValidationPipe(LoginSmsRequest)) body: { phone: string; smsCode: string }) {
    const result = await this.auth.loginWithSms(body.phone, body.smsCode);
    return {
      success: true,
      data: {
        userId: result.userId,
        role: result.role,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        accessExpiresAt: result.accessExpiresAt,
        refreshExpiresAt: result.refreshExpiresAt,
      },
    };
  }

  /** 注册（必传 smsCode，dev stub 固定 123456） */
  @Public()
  @Audit({ resource: 'User', maskFields: ['password'] })
  @RateLimit(
    { key: 'register:ip:${ip}', limit: 5, window: 60 },
    { key: 'register:phone:${body.phone}', limit: 3, window: 60 },
  )
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body(new ZodValidationPipe(RegisterRequest)) body: {
    phone: string;
    password: string;
    email?: string;
    name?: string;
    smsCode?: string;
  }) {
    const result = await this.auth.registerUser(body);
    return {
      success: true,
      data: {
        userId: result.userId,
        role: result.role,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        accessExpiresAt: result.accessExpiresAt,
        refreshExpiresAt: result.refreshExpiresAt,
      },
    };
  }

  /** 发 SMS 验证码（stub 固定 123456，W6 切东帝汶本地） */
  @Public()
  @Audit({ resource: 'SmsCode', skip: true })
  @RateLimit(
    { key: 'sms:phone:${body.phone}:60s', limit: 1, window: 60 },
    { key: 'sms:phone:${body.phone}:1h', limit: 5, window: 3600 },
    { key: 'sms:phone:${body.phone}:24h', limit: 10, window: 86400 },
    { key: 'sms:ip:${ip}:1h', limit: 20, window: 3600 },
  )
  @Post('sms-code')
  @HttpCode(HttpStatus.OK)
  async sendSmsCode(@Body(new ZodValidationPipe(SendSmsCodeRequest)) body: { phone: string; scene?: OtpScene }) {
    const result = await this.auth.sendSmsCode(body.phone, body.scene ?? 'LOGIN');
    return { success: true, data: { expireIn: result.expireIn } };
  }

  /** SMS 找回密码 */
  @Public()
  @Audit({ resource: 'User', maskFields: ['newPassword', 'smsCode'] })
  @RateLimit(
    { key: 'reset:ip:${ip}', limit: 5, window: 60 },
    { key: 'reset:phone:${body.phone}', limit: 3, window: 60 },
  )
  @Post('password-reset')
  @HttpCode(HttpStatus.OK)
  async passwordReset(@Body(new ZodValidationPipe(PasswordResetRequest)) body: {
    phone: string;
    smsCode: string;
    newPassword: string;
  }) {
    await this.auth.resetPassword(body);
    return { success: true, data: null };
  }

  /** 刷新 token */
  @Public()
  @Audit({ resource: 'RefreshToken', skip: true })
  @RateLimit({ key: 'refresh:ip:${ip}', limit: 30, window: 60 })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body(new ZodValidationPipe(RefreshRequest)) body: { refreshToken: string }) {
    // v1.2 Token Family：原子消费旧 refresh token（Lua 标记 used）
    // - 重放（旧 token 再次用）-> Lua 撤销整个 family + REPLAY
    // - 并发刷新同一旧 jti -> 只一个 OK，另一个 REPLAY
    const { payload, familyId, userId } = await this.auth.consumeRefreshToken(body.refreshToken);
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: 'E-USER-001',
        message: 'User not found',
      });
    }
    // W7-fix（审查 P0 #1）：SUSPENDED/DELETED 用户不能续签 token
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'E-USER-005',
        message: `User status is ${user.status}, refresh disabled`,
      });
    }
    // W7-fix（审查 P0 #2）：密码重置后旧 refreshToken 失效（passwordChangedAt 检查保留）
    if (user.passwordChangedAt && payload.iat) {
      const passwordChangedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (payload.iat < passwordChangedAtSec) {
        throw new UnauthorizedException({
          code: 'E-AUTH-006',
          message: 'Password has been changed, please login again',
        });
      }
    }
    const role = this.auth.toContractRole(user.role);
    const deviceType = this.auth.inferDeviceTypeFromRole(role);
    // 签新 pair（同 familyId，保持会话族连续性）
    const access = await this.auth.signAccessToken(user.id, role, deviceType);
    const refresh = await this.auth.signRefreshToken(user.id, deviceType, familyId);
    const now = Math.floor(Date.now() / 1000);
    return {
      success: true,
      data: {
        accessToken: access.token,
        refreshToken: refresh.token,
        accessExpiresAt: now + access.expiresIn,
        refreshExpiresAt: now + refresh.expiresIn,
      },
    };
  }

  /** Logout：refresh token jti 加 Redis 黑名单 */
  /** Logout：撤销整个 refresh family（v1.2，用 refreshToken body，不需 accessToken）*/
  @Public()
  @Audit({ resource: 'RefreshToken', skip: true })
  @RateLimit({ key: 'logout:ip:${ip}', limit: 30, window: 60 })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body(new ZodValidationPipe(LogoutRequest)) body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
    return { success: true, data: null };
  }
}
