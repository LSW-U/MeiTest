/**
 * Mock 登录端点（仅 dev/staging，prod 时 AuthModule 不注册此 controller）
 *
 * 决策依据：W1-D4-T6 — 三端 mock 登录测试用
 *   - 跳过密码校验
 *   - 接受任意 role + deviceType 组合，发对应权限的 token
 *   - 默认 userId = seed super_admin（保证 DB 有 user，业务接口能调通）
 *   - 非常规组合（如 super_admin + client_app）记 warning 便于排查
 *
 * Prod 安全：auth.module.ts 按 NODE_ENV === 'production' 条件注册（路由根本不存在）
 *
 * 路径：POST /api/v1/common/auth/mock-login
 */
import { Controller, Post, Body, HttpException, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { setAuthCookiesForDevice } from '../../shared/auth/cookie-helper';
import { AuthService } from './auth.service';
import { db } from '../../shared/db';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { logger } from '../../shared/logger/logger';
import { Public } from '../../shared/decorators/public.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { Role, DeviceType } from '@meimart/api-contract';

const MockLoginRequest = z.object({
  role: z.enum(['SUPER_ADMIN', 'CUSTOMER', 'RIDER', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE']),
  deviceType: z.enum(['client_app', 'rider_app', 'admin_web']),
  userId: z.string().uuid().optional(),
});
type MockLoginRequestType = z.infer<typeof MockLoginRequest>;

/** Seed super_admin phone（与 seed.ts 一致） */
const SEED_ADMIN_PHONE = '+670999999999';

/** 正常 role × deviceType 组合（用于检测非常规组合并 warning） */
const NORMAL_COMBINATIONS: Record<Role, DeviceType[]> = {
  SUPER_ADMIN: ['admin_web'],
  CUSTOMER: ['client_app'],
  RIDER: ['rider_app'],
  WAREHOUSE_STAFF: ['admin_web'],
  CUSTOMER_SERVICE: ['admin_web'],
};

@Controller('api/v1/common/auth')
export class MockLoginController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Audit({ resource: 'MockLogin' })
  @Post('mock-login')
  async mockLogin(
    @Body(new ZodValidationPipe(MockLoginRequest)) body: MockLoginRequestType,
    @Res({ passthrough: true }) res: Response,
  ) {
    // 找 user：优先 userId（调用方指定），其次按 phone 找 seed admin
    const user = body.userId
      ? await db.user.findUnique({ where: { id: body.userId } })
      : await db.user.findUnique({ where: { phone: SEED_ADMIN_PHONE } });

    if (!user) {
      throw new HttpException(
        {
          code: 'E-AUTH-009',
          message: `Mock user not found (need seed admin with phone=${SEED_ADMIN_PHONE})`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // 非常规组合记 warning（不强制拒绝，mock 工具保留灵活性）
    if (!NORMAL_COMBINATIONS[body.role].includes(body.deviceType)) {
      logger.warn({
        msg: 'MOCK_LOGIN_UNUSUAL_COMBINATION',
        userId: user.id,
        role: body.role,
        deviceType: body.deviceType,
        note: 'Allowing unusual role×deviceType combination for testing',
      });
    }

    // 签发 token（role 用客户端传的，不强制 DB 一致 — mock 测试灵活性）
    const tokenPair = await this.auth.signTokenPair(user.id, body.role, body.deviceType);
    // 约束 6：admin_web mock 登录也走 httpOnly cookie（dev/staging 联调 admin-web 用）
    setAuthCookiesForDevice(res, body.deviceType, tokenPair);

    logger.warn({
      msg: 'MOCK_LOGIN_USED',
      userId: user.id,
      role: body.role,
      deviceType: body.deviceType,
      phone: user.phone,
      note: 'PROD MUST DISABLE — auth.module.ts should not register this controller',
    });

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          role: body.role,
          deviceType: body.deviceType,
          phone: user.phone,
          email: user.email,
          name: user.name,
        },
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        accessExpiresAt: tokenPair.accessExpiresAt,
        refreshExpiresAt: tokenPair.refreshExpiresAt,
      },
    };
  }
}
