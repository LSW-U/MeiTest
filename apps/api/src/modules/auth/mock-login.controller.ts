/**
 * Mock 登录端点（仅 dev/staging，prod 返回 404）
 *
 * 决策依据：W1-D4-T6 — 三端 mock 登录测试用
 *   - 跳过密码校验
 *   - 接受任意 role + deviceType 组合，发对应权限的 token
 *   - 默认 userId = seed super_admin（保证 DB 有 user，业务接口能调通）
 *   - prod NODE_ENV === 'production' 时返回 404
 *
 * 路径：POST /api/v1/common/auth/mock-login
 *
 * body:
 *   {
 *     role: 'super_admin' | 'customer' | 'rider' | 'warehouse_staff' | 'customer_service',
 *     deviceType: 'client_app' | 'rider_app' | 'admin_web',
 *     userId?: string  // 可选，默认用 seed admin
 *   }
 *
 * response:
 *   {
 *     success: true,
 *     data: {
 *       user: { id, role, deviceType, phone, email, name },
 *       accessToken, refreshToken, accessExpiresAt, refreshExpiresAt
 *     }
 *   }
 */
import { Controller, Post, Body, HttpException, HttpStatus, Logger, Inject } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { db } from '../../shared/db';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';

const MockLoginRequest = z.object({
  role: z.enum(['super_admin', 'customer', 'rider', 'warehouse_staff', 'customer_service']),
  deviceType: z.enum(['client_app', 'rider_app', 'admin_web']),
  userId: z.string().uuid().optional(),
});
type MockLoginRequestType = z.infer<typeof MockLoginRequest>;

/** Seed super_admin phone（与 seed.ts 一致） */
const SEED_ADMIN_PHONE = '+670999999999';

@Controller('api/v1/common/auth')
export class MockLoginController {
  private readonly logger = new Logger(MockLoginController.name);

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('mock-login')
  async mockLogin(
    @Body(new ZodValidationPipe(MockLoginRequest)) body: MockLoginRequestType,
  ) {
    // prod 强制 404（防止误部署）
    if (process.env.NODE_ENV === 'production') {
      throw new HttpException(
        { code: 'E-COMMON-NOT-FOUND', message: 'Not Found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // 找 user：优先 userId（调用方指定），其次按 phone 找 seed admin
    const user = body.userId
      ? await db.user.findUnique({ where: { id: body.userId } })
      : await db.user.findUnique({ where: { phone: SEED_ADMIN_PHONE } });

    if (!user) {
      throw new HttpException(
        {
          code: 'E-AUTH-MOCK-USER-NOT-FOUND',
          message: `Mock user not found (need seed admin with phone=${SEED_ADMIN_PHONE})`,
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // 签发 token（role 用客户端传的，不强制 DB 一致 — mock 测试灵活性）
    const tokenPair = await this.auth.signTokenPair(user.id, body.role, body.deviceType);

    this.logger.warn({
      msg: 'MOCK_LOGIN_USED',
      userId: user.id,
      role: body.role,
      deviceType: body.deviceType,
      phone: user.phone,
      note: 'PROD MUST DISABLE — check NODE_ENV guard',
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
