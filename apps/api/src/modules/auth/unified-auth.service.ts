/**
 * Unified Auth Service - 统一手机号登录/注册（W7-ext-H）
 *
 * 消费者（BUYER）App 统一入口：
 *   - sendSmsCodeWithChallenge：发送验证码 + 生成 challengeId（统一 202，防枚举）
 *   - verifyAndDispatch：验证码校验 + 分流（LOGIN/REGISTER/BLOCKED）
 *   - completeRegistration：原子消费 ticket + DB 事务创建 CUSTOMER
 *
 * 决策依据：统一手机号入口契约（11 条 registrationTicket 决策）
 * 批A（2026-09-15）R11+R19 收敛：内联 stub 删除，OTP 收发全部走 otp factory
 * （getOtpStrategy('SMS')），unified 只持有 challengeId→(scene,target) 映射键。
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
import { createHash } from 'crypto';
import { db, withTransaction } from '../../shared/db';
import { redis } from '../../shared/cache';
import { createTicket, consumeTicket } from '../../shared/cache';
import { rateLimit } from '../../shared/cache/rate-limit';
import { assertCaptchaPassed } from '../../infrastructure/otp/captcha';
import { logger } from '../../shared/logger/logger';
import { getOtpStrategy } from '../../infrastructure/otp/otp.factory';
import type { OtpScene } from '../../infrastructure/otp/otp-strategy';
import { AuthService } from './auth.service';
import { Prisma } from '../../prisma/client';

const OTP_TTL_SECONDS = 300; // 5 分钟（code 键由 factory 落，映射键同 TTL）

/**
 * 映射键前缀（批A R19）：`otp:chal:{challengeId}` → { scene, target }
 *
 * 旧实现写 `otp:sms:{challengeId}` 与工厂 code 键 `otp:sms:{scene}:{target}`
 * 同前缀双语义混用——换 `otp:chal:` 前缀消除（预研笔记③3.1）。
 */
const CHALLENGE_KEY_PREFIX = 'otp:chal:';
/** 统一入口固定 scene：发码时登录/注册尚未分流，OTP 语义=「本机号持有证明」 */
const UNIFIED_SMS_SCENE: OtpScene = 'LOGIN';

@Injectable()
export class UnifiedAuthService {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /**
   * 发送验证码（统一入口，生成 challengeId）
   *
   * 无论手机号是否已注册，统一返回 challengeId（防枚举）。
   * 批A R11 收敛：删内联 stub，只调 otp factory——code 键 `otp:sms:{scene}:{target}`
   * 由 factory 落（stub/真实网关按 SMS_PROVIDER 分流），unified 只落映射键
   * `otp:chal:{challengeId}` → { scene, target }（R19，verify 据此走 factory）。
   */
  async sendSmsCodeWithChallenge(
    phone: string,
    deviceId?: string,
    captcha?: { captchaId?: string; captchaText?: string },
  ): Promise<{ challengeId: string; expireIn: number }> {
    const challengeId = genId();
    const scene = UNIFIED_SMS_SCENE;

    // 批A2-2：图形验证码闸门（决策7/8）——先图形码后频控（防刷优先：
    // 图形码不过的请求不占频控桶）；开关 SMS_CAPTCHA_REQUIRED 关时直接放行
    await assertCaptchaPassed(captcha);

    // 批A2-2：图形验证码闸门（决策7/8）——先图形码后频控（防刷优先：
    // 图形码不过的请求不占频控桶）；开关 SMS_CAPTCHA_REQUIRED 关时直接放行
    await assertCaptchaPassed(captcha);

    // P2-3（方案 a）：phone 维度频控下沉到 captcha 之后（原在 controller @RateLimit，
    // 批A2-1 T3 迁入）——错 captcha 的请求不烧 phone 桶。三段滑动窗口语义/错误码
    // 与原 guard 版完全一致（60s×1 / 1h×5 / 24h×10，超限 429 E-RATELIMIT-001）。
    await assertPhoneRateLimit(phone);

    // 批A2-1 T3：deviceId 维度频控（5 次/24h）——设备指纹刷码防线（换号不换设备照样拦）。
    // 先于发码（超限不打真实通道的钱）；缺 deviceId 跳过（旧客户端兼容）；超限 429
    // 语义与 RateLimitGuard 家族统一（E-RATELIMIT-001，key 已 hash 不外泄明文指纹）
    if (deviceId) {
      await assertDeviceIdRateLimit(deviceId);
    }

    // 发码走 factory（A-1 已改造：stub 固定码 / gateway 真发，缺凭据 fail-fast E-SMS-001）
    await getOtpStrategy('SMS').sendCode({ target: phone, scene });

    // 映射键：challengeId → (scene, target)，同 TTL 5min
    await redis.set(
      `${CHALLENGE_KEY_PREFIX}${challengeId}`,
      JSON.stringify({ scene, target: phone }),
      'EX',
      OTP_TTL_SECONDS,
    );

    logger.info({
      msg: '[SMS] sendCode unified',
      phone: maskPhone(phone),
      challengeId,
    });

    void deviceId; // 预留设备指纹（风控用，频控已在发码前接上）
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
    // 校验 OTP（批A R11 收敛：查映射键 → 走 factory 按 scene:target 校验）
    const chalData = await redis.get(`${CHALLENGE_KEY_PREFIX}${challengeId}`);
    if (!chalData) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    let chal: { scene: OtpScene; target: string };
    try {
      chal = JSON.parse(chalData) as { scene: OtpScene; target: string };
    } catch {
      // 键值损坏（部署瞬间旧结构残留/脏数据）→ 按验证失败处理，不外泄细节
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    // N-2 #1 phone 绑定校验：challenge 只对发码时的 target 有效（保留原语义，防换号撞 verify）
    if (chal.target !== phone) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    // 走 factory 校验（reason 枚举 → N-2 #4 全部映射 E-USER-003，不外泄 WRONG_CODE/EXPIRED 细节）
    const verifyResult = await getOtpStrategy('SMS').verifyCode({
      target: chal.target,
      code,
      scene: chal.scene,
    });
    if (!verifyResult.valid) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    // 单次消费：code 键 factory 已删；这里删映射键（两键齐删）
    await redis.del(`${CHALLENGE_KEY_PREFIX}${challengeId}`);

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

/**
 * phone 维度频控（P2-3 方案 a：从 controller @RateLimit 下沉，批A2-1 T3 语义原样保留）：
 * 同号 60s×1 / 1h×5 / 24h×10，Redis 滑动窗口（复用 rate-limit.ts），
 * 超限 429 E-RATELIMIT-001（与 guard 版同款响应结构，前端无感）。
 *
 * 位置：captcha 之后（错 captcha 不烧 phone 桶）、deviceId 频控之前（同族防线一起拦在发码前）。
 */
async function assertPhoneRateLimit(phone: string): Promise<void> {
  const tiers: Array<{ suffix: string; limit: number; window: number }> = [
    { suffix: '60s', limit: 1, window: 60 },
    { suffix: '1h', limit: 5, window: 3600 },
    { suffix: '24h', limit: 10, window: 86400 },
  ];
  for (const t of tiers) {
    const key = `sms:phone:${phone}:${t.suffix}`;
    const result = await rateLimit(key, t.limit, t.window);
    if (!result.allowed) {
      logger.warn({
        msg: 'RATE_LIMIT_EXCEEDED',
        reason: 'rate_limited', // R17 拒发计数分桶（guard 同族）
        key,
        current: result.current,
        limit: t.limit,
        retryAfter: result.retryAfter,
      });
      throw new HttpException(
        {
          code: 'E-RATELIMIT-001',
          message: 'Too many requests, please retry later',
          details: { retryAfter: result.retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/**
 * deviceId 维度频控（批A2-1 T3）：5 次/24h，Redis 滑动窗口（复用 rate-limit.ts，
 * 与 controller @RateLimit 同族实现，超限 429 E-RATELIMIT-001 同款语义）。
 *
 * key：deviceId SHA256 截断 16（与 RateLimitGuard.resolveKey 同款 hash——
 * Redis key 不含明文设备指纹）。客户端伪造 deviceId 只影响自身桶，不碰手机号/IP 桶。
 */
async function assertDeviceIdRateLimit(deviceId: string): Promise<void> {
  const hashed = createHash('sha256').update(deviceId).digest('hex').slice(0, 16);
  const result = await rateLimit(`sms:device:${hashed}:24h`, 5, 86400);
  if (!result.allowed) {
    logger.warn({
      msg: 'RATE_LIMIT_EXCEEDED',
      reason: 'rate_limited', // R17 拒发计数分桶（guard 同族）
      key: `sms:device:${hashed}:24h`, // 已 hash，不含明文设备指纹
      current: result.current,
      limit: result.limit,
      retryAfter: result.retryAfter,
    });
    throw new HttpException(
      {
        code: 'E-RATELIMIT-001',
        message: 'Too many requests, please retry later',
        details: { retryAfter: result.retryAfter },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
