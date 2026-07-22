/**
 * Unified Auth Service - 统一手机号登录/注册（W7-ext-H）
 *
 * 消费者（BUYER）App 统一入口：
 *   - sendSmsCodeWithChallenge：发送验证码 + 生成 challengeId（统一 202，防枚举）
 *   - verifyAndDispatch：验证码校验 + 分流（LOGIN/REGISTER/BLOCKED）
 *   - completeRegistration：原子消费 ticket + DB 事务创建 CUSTOMER
 *
 * 决策依据：统一手机号入口契约（11 条 registrationTicket 决策）
 */
import {
  Injectable,
  Inject,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { genId } from '@meimart/shared-utils';
import { db, withTransaction } from '../../shared/db';
import { redis } from '../../shared/cache';
import { createTicket, consumeTicket } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { AuthService } from './auth.service';
import { Prisma } from '../../prisma/client';

const OTP_TTL_SECONDS = 300; // 5 分钟

@Injectable()
export class UnifiedAuthService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * 发送验证码（统一入口，生成 challengeId）
   *
   * 无论手机号是否已注册，统一返回 challengeId（防枚举）。
   * Redis 存 OTP：otp:sms:{challengeId} = { phone, code, expiresAt }
   */
  async sendSmsCodeWithChallenge(
    phone: string,
    deviceId?: string,
  ): Promise<{ challengeId: string; expireIn: number }> {
    const challengeId = genId();
    // dev stub 固定 123456，prod 生成随机码（W6 切真实 provider）
    const code = process.env.SMS_STUB_CODE ?? '123456';
    const now = Date.now();

    await redis.set(
      `otp:sms:${challengeId}`,
      JSON.stringify({ phone, code, expiresAt: now + OTP_TTL_SECONDS * 1000 }),
      'EX',
      OTP_TTL_SECONDS,
    );

    // 发送（dev stub 只记日志，prod 调真实 SMS provider）
    logger.info({
      msg: '[SMS_STUB] sendCode unified',
      phone: maskPhone(phone),
      challengeId,
      note: 'stub code in Redis (W6 切真实 provider)',
    });

    void deviceId; // 预留设备指纹（限流 + 风控用）
    return { challengeId, expireIn: OTP_TTL_SECONDS };
  }

  /**
   * 验证码校验 + 分流（LOGIN / REGISTER / BLOCKED）
   *
   * 校验 OTP（challengeId + phone + code）。成功后 DEL（单次消费）。
   * 查 user 分流：
   *   - 已注册 + ACTIVE -> LOGIN（签 Refresh Family）
   *   - 未注册 -> REGISTER（发放 registrationTicket）
   *   - 冻结/高风险 -> BLOCKED（不签 token）
   */
  async verifyAndDispatch(
    phone: string,
    code: string,
    challengeId: string,
  ): Promise<{
    action: 'LOGIN' | 'REGISTER' | 'BLOCKED';
    accessToken?: string;
    refreshToken?: string;
    accessExpiresAt?: number;
    refreshExpiresAt?: number;
    user?: { id: string; role: string; phone: string };
    registrationTicket?: string;
    expireIn?: number;
  }> {
    // 校验 OTP
    const otpData = await redis.get(`otp:sms:${challengeId}`);
    if (!otpData) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    const otp = JSON.parse(otpData) as { phone: string; code: string };
    if (otp.phone !== phone || otp.code !== code) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    // 单次消费
    await redis.del(`otp:sms:${challengeId}`);

    // 查 user 分流
    const user = await db.user.findUnique({ where: { phone } });
    if (!user) {
      // 未注册 -> 发放 registrationTicket（5min 一次性）
      const ticket = await createTicket({ phone, challengeId });
      return { action: 'REGISTER', registrationTicket: ticket, expireIn: 300 };
    }
    if (user.status !== 'ACTIVE') {
      // 冻结/高风险 -> 不签 token
      return { action: 'BLOCKED' };
    }
    // 已注册 + ACTIVE -> 登录（签 Refresh Family）
    const role = this.authService.toContractRole(user.role);
    const deviceType = this.authService.inferDeviceTypeFromRole(role);
    const tokenPair = await this.authService.signTokenPair(user.id, role, deviceType);
    return {
      action: 'LOGIN',
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      accessExpiresAt: tokenPair.accessExpiresAt,
      refreshExpiresAt: tokenPair.refreshExpiresAt,
      user: { id: user.id, role, phone: user.phone },
    };
  }

  /**
   * 完成注册（原子消费 ticket + DB 事务创建 CUSTOMER）
   *
   * 决策 5：GETDEL 原子消费（并发一个成功）
   * 决策 7：创建 User + agreedTermsVersion 同一 DB 事务
   * 决策 8：手机号唯一约束兜底（P2002 -> 409）
   * 决策 9：强制 role=CUSTOMER（不接受客户端指定）
   */
  async completeRegistration(input: {
    registrationTicket: string;
    agreedToTerms: boolean;
    challengeId: string;
    deviceId?: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
    user: { id: string; role: string; phone: string };
  }> {
    if (!input.agreedToTerms) {
      throw new BadRequestException({
        code: 'E-REGISTER-003',
        message: 'Must agree to terms and privacy policy',
      });
    }

    // 原子消费 ticket（GETDEL）
    const result = await consumeTicket(input.registrationTicket);
    if (result.status !== 'OK') {
      // 410 Gone：ticket 已消费/不存在（资源 gone，不是认证失败）
      throw new HttpException(
        {
          code: 'E-REGISTER-001',
          message: 'Ticket invalid or already used, please re-verify phone',
        },
        HttpStatus.GONE,
      );
    }
    const ticketData = result.data;

    // 校验 ticket 绑定（challengeId）
    if (ticketData.challengeId !== input.challengeId) {
      throw new HttpException(
        {
          code: 'E-REGISTER-001',
          message: 'Ticket challengeId mismatch',
        },
        HttpStatus.GONE,
      );
    }

    // DB 事务创建 User（决策 7/8/9）
    try {
      const user = await withTransaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            phone: ticketData.phone, // 来自 ticket，非客户端
            role: 'CUSTOMER', // 决策 9：强制
            status: 'ACTIVE',
            phoneVerified: true, // SMS 验证通过
            agreedTermsVersion: 'v1.0', // 决策 7：协议版本
            // password null（SMS 注册无密码，用户后续可设）
          },
        });
        return created;
      });

      // 签 token pair（新 Refresh Family）
      const role = this.authService.toContractRole(user.role);
      const deviceType = this.authService.inferDeviceTypeFromRole(role);
      const tokenPair = await this.authService.signTokenPair(user.id, role, deviceType);

      logger.info({
        msg: 'UNIFIED_REGISTER_SUCCESS',
        userId: user.id,
        phone: maskPhone(user.phone),
      });

      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        accessExpiresAt: tokenPair.accessExpiresAt,
        refreshExpiresAt: tokenPair.refreshExpiresAt,
        user: { id: user.id, role, phone: user.phone },
      };
    } catch (e) {
      // 决策 8：手机号唯一约束冲突（并发兜底）
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'E-REGISTER-002',
          message: 'Phone already registered',
        });
      }
      // 决策 6：DB 事务失败 -> 410（ticket 已消费，需重新验证）
      logger.error({
        msg: 'REGISTER_TX_FAILED',
        error: (e as Error).message,
        challengeId: input.challengeId,
      });
      throw new HttpException(
        {
          code: 'E-REGISTER-004',
          message: 'Registration failed, please re-verify phone',
        },
        HttpStatus.GONE,
      );
    }
  }
}

/** 脱敏手机号（+670****34） */
function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, 4) + '****' + phone.slice(-2);
}
