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
import { Controller, Post, Body, Inject, HttpCode, HttpStatus, UnauthorizedException, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { setAuthCookiesForDevice, clearAuthCookies, getRefreshTokenFromCookie } from '../../shared/auth/cookie-helper';
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
  async loginPassword(
    @Body(new ZodValidationPipe(LoginPasswordRequest)) body: { phone: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginWithPassword(body.phone, body.password);
    // 约束 6：admin_web → httpOnly cookie（按 role 推断 deviceType）；移动端 Bearer 不动 cookie
    const deviceType = this.auth.inferDeviceTypeFromRole(result.role);
    setAuthCookiesForDevice(res, deviceType, result);
    // F7：admin_web token 仅进 httpOnly cookie，body 不回吐（防 XSS 经 fetch response 读 token 架空 httpOnly）
    // 移动端（client_app/rider_app）继续 body 返回 token（靠 body 存 SecureStore，无 cookie 通道）
    if (deviceType === 'admin_web') {
      return {
        success: true,
        data: {
          userId: result.userId,
          role: result.role,
          accessExpiresAt: result.accessExpiresAt,
          refreshExpiresAt: result.refreshExpiresAt,
        },
      };
    }
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

  /**
   * @deprecated 已由统一入口 POST /sms/verify (action=LOGIN) 替代，消费者 App 切换后 2 周下线
   * SMS 验证码登录（不存在自动注册）
   */
  @Public()
  @Audit({ resource: 'User' })
  @RateLimit(
    { key: 'login:ip:${ip}', limit: 10, window: 60 },
    { key: 'login:phone:${body.phone}', limit: 5, window: 60 },
  )
  @Post('login-sms')
  @HttpCode(HttpStatus.OK)
  async loginSms(
    @Body(new ZodValidationPipe(LoginSmsRequest)) body: { phone: string; smsCode: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.loginWithSms(body.phone, body.smsCode);
    setAuthCookiesForDevice(res, this.auth.inferDeviceTypeFromRole(result.role), result);
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

  /**
   * @deprecated 已由统一入口 POST /register/complete (ticket + SMS) 替代，消费者 App 切换后 2 周下线
   * 注册（必传 smsCode，dev stub 固定 123456）
   */
  @Public()
  @Audit({ resource: 'User', maskFields: ['password'] })
  @RateLimit(
    { key: 'register:ip:${ip}', limit: 5, window: 60 },
    { key: 'register:phone:${body.phone}', limit: 3, window: 60 },
  )
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Body(new ZodValidationPipe(RegisterRequest)) body: {
      phone: string;
      password: string;
      email?: string;
      name?: string;
      smsCode?: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.registerUser(body);
    setAuthCookiesForDevice(res, this.auth.inferDeviceTypeFromRole(result.role), result);
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

  /**
   * @deprecated 已由统一入口 POST /sms/send (challengeId 模式) 替代，消费者 App 切换后 2 周下线
   * 发 SMS 验证码（stub 固定 123456，W6 切东帝汶本地）
   */
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
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequest)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 约束 6 双通道：body 优先（移动端 Bearer），fallback httpOnly cookie（admin_web）
    const refreshToken = body.refreshToken ?? getRefreshTokenFromCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: 'E-AUTH-005',
        message: 'Refresh token required (provide via body or cookie)',
      });
    }
    // v1.2 Token Family：原子消费旧 refresh token（Lua 标记 used）
    // - 重放（旧 token 再次用）-> Lua 撤销整个 family + REPLAY
    // - 并发刷新同一旧 jti -> 只一个 OK，另一个 REPLAY
    const { payload, familyId, userId } = await this.auth.consumeRefreshToken(refreshToken);
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
    const tokenPair = {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessExpiresAt: now + access.expiresIn,
      refreshExpiresAt: now + refresh.expiresIn,
    };
    // 约束 6：admin_web 轮换后更新 httpOnly cookie
    setAuthCookiesForDevice(res, deviceType, tokenPair);
    // F7：admin_web token 仅 cookie，body 不回吐（防静默刷新时 XSS 经 response 读 token）
    if (deviceType === 'admin_web') {
      return {
        success: true,
        data: {
          accessExpiresAt: tokenPair.accessExpiresAt,
          refreshExpiresAt: tokenPair.refreshExpiresAt,
        },
      };
    }
    return { success: true, data: tokenPair };
  }

  /** Logout：refresh token jti 加 Redis 黑名单 */
  /** Logout：撤销整个 refresh family（v1.2，用 refreshToken body，不需 accessToken）*/
  @Public()
  @Audit({ resource: 'RefreshToken', skip: true })
  @RateLimit({ key: 'logout:ip:${ip}', limit: 30, window: 60 })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body(new ZodValidationPipe(LogoutRequest)) body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 约束 6 双通道：body 优先，fallback cookie
    const refreshToken = body.refreshToken ?? getRefreshTokenFromCookie(req);
    // revokeFamily：refreshToken 已过期/失效时不阻塞（保证登出幂等 + cookie 总能清）
    if (refreshToken) {
      try {
        await this.auth.logout(refreshToken);
      } catch {
        // refreshToken 失效：跳过 family 撤销，继续清 cookie
      }
    }
    // 无条件 clear cookie（幂等：移动端调到也无副作用）
    clearAuthCookies(res);
    return { success: true, data: null };
  }
}
