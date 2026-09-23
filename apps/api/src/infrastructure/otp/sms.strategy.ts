/**
 * SMS 策略（手机验证）— stub / 真实网关 / 腾讯云三通道（批A R1 切真 + 批A2 tencent）
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP 完整方案 + 批A-预研笔记-20260914.md ③3.3/⑤步骤2
 *   + 任务书-批A2-腾讯云SMS真实接入.md（执行权威）
 *   - dev（默认）：stub 固定验证码，日志标 [SMS_STUB]，SMS_STUB_CODE 仅 stub 生效
 *   - prod：SMS_PROVIDER 默认 tencent（批A2：与 gateway 同语义）——
 *     · tencent：腾讯云国际短信（tencent-sms.strategy.ts，官方 SDK TC3 签名）
 *     · gateway：通用 HTTP 网关（sms-gateway.client.ts，fetch 直调）
 *     缺凭据 → sendCode 运行时拒发 503 E-SMS-001（P1-1 审查修复：构造期不校验不
 *     throw，否则 otp.factory 模块作用域 new 会让整个 API 启动即死，违背 R8
 *     「不退进程，爆炸半径=登录」）
 *   - 逃生门：SMS_STUB_ALLOWED=true 时 prod 也允许 stub（R8，仅救急）
 *
 * provider 解析：模块级缓存（照抄 push.strategy.ts:38-80 骨架，测试用
 * clearSmsProviderCache() 重置；env 只在进程启动时读取，缓存安全）。
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { readSmsGatewayConfig, sendSmsViaGateway } from './sms-gateway.client';
import { assertSmsDailyBudget } from './sms-budget';
import { TencentSmsStrategy } from './tencent-sms.strategy';
import type {
  OtpStrategy,
  OtpSendInput,
  OtpSendOutput,
  OtpVerifyInput,
  OtpVerifyOutput,
} from './otp-strategy';

const CODE_TTL_SECONDS = 5 * 60; // 5 分钟
const KEY_PREFIX = 'otp:sms:';

/** 生产缺凭据拒发错误码（E-SMS 段 001-099 预留，预研笔记④已核全仓空闲；五语 errors.json 已注册） */
export const E_SMS_001 = 'E-SMS-001';

/** 批A2：tencent 策略复用同款 TTL / 键结构（验证链路不感知 provider） */
export { CODE_TTL_SECONDS, KEY_PREFIX };

type SmsProvider = 'stub' | 'gateway' | 'tencent';

let cachedProvider: SmsProvider | null = null;

/** 重置 provider 解析缓存（仅测试用：process.env 切换后调用） */
export function clearSmsProviderCache(): void {
  cachedProvider = null;
}

/**
 * 解析 SMS 通道：显式 SMS_PROVIDER（stub|gateway|tencent）；未配置时 dev 默认 stub、
 * production 默认 tencent（批A2：与 gateway 同语义——生产默认走真实通道，缺凭据
 * 由 sendCode 运行时拒发兜底，不走降级）
 *
 * export：sms-startup-check.ts（R8 启动软告警）复用同一解析，不重复实现
 */
export function resolveProvider(): SmsProvider {
  if (cachedProvider) return cachedProvider;
  const explicit = process.env.SMS_PROVIDER;
  if (explicit === 'stub' || explicit === 'gateway' || explicit === 'tencent') {
    cachedProvider = explicit;
    return cachedProvider;
  }
  cachedProvider = process.env.NODE_ENV === 'production' ? 'tencent' : 'stub';
  return cachedProvider;
}

/** 拒发错误统一 503 + 明确码（P1-2：all-exceptions.filter 走 HttpException 分支，
 * 客户端拿 E-SMS-001「验证码服务暂不可用」语义，不落泛化 500 E-COMMON-002） */
export function smsUnavailableException(detail: string): HttpException {
  return new HttpException(
    {
      code: E_SMS_001,
      message:
        'SMS verification service is temporarily unavailable. ' +
        `${detail} (Set SMS_PROVIDER=stub for dev, or SMS_STUB_ALLOWED=true as escape hatch)`,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * provider=gateway 时校验凭据齐备，缺 → 抛 503 E-SMS-001（运行时拒发，R8 拒发不静默降级）
 *
 * 逃生门：SMS_STUB_ALLOWED=true 时返回 'stub'（救急放行，日志留痕），
 * 不只是跳过校验 —— 否则 isMock=false 但无凭据，sendCode 必炸。
 *
 * R17 拒发计数：拒绝路径统一先落 warn 结构化日志（reason 分桶：
 * not_configured / provider_error），步骤 5 main.ts 软告警与运维聚合按此字段过滤。
 *
 * P1-1（审查修复 20260915）：本函数只在 sendCode 运行时调用（模块加载/构造期
 * 不 throw，避免 otp.factory 模块作用域 new SmsStrategy() 让整个 API 启动即死）。
 */
function resolveGatewayOrEscape(): 'gateway' | 'stub' {
  if (process.env.SMS_STUB_ALLOWED === 'true') {
    logger.warn({
      msg: 'SMS_STUB_ALLOWED_ESCAPE_HATCH',
      note: 'SMS_STUB_ALLOWED=true; gateway credentials not verified, falling back to stub',
    });
    return 'stub';
  }
  if (!readSmsGatewayConfig()) {
    // R17 拒发计数：not_configured 分桶（运行时拒发前留痕）
    logger.warn({
      msg: 'SMS_SEND_REFUSED',
      reason: 'not_configured',
      provider: 'gateway',
      note: 'gateway credentials missing; OTP send refused with 503 E-SMS-001',
    });
    throw smsUnavailableException(
      'SMS_GATEWAY_URL / SMS_GATEWAY_AUTH_VALUE / SMS_GATEWAY_PAYLOAD_TEMPLATE not fully configured',
    );
  }
  return 'gateway';
}

/** 脱敏手机号（+670****78，N-2 第3项）：定义移至 sms-gateway.client.ts（P3-1 修复，
 * 避免 strategy↔client 循环 import），此处 re-export 保持既有 import 路径兼容 */
import { maskSmsPhone } from './sms-gateway.client';
export { maskSmsPhone };

export class SmsStrategy implements OtpStrategy {
  readonly channel = 'SMS' as const;
  /** isMock 构造期只定「意图」：provider=gateway → 真实通道（预研笔记③3.3 readonly）
   * P1-1（审查修复 20260915）：构造期不再校验凭据也不 throw——otp.factory 是模块
   * 作用域 new SmsStrategy()，构造期抛错会让整个 API 生产启动即死（违背 R8
   * 「不退进程，爆炸半径=登录」）。真正的凭据校验在 sendCode 运行时拒发。 */
  readonly isMock: boolean;

  constructor() {
    // 逃生门开 = stub 意图（isMock 同步为 true，语义与 A-1 一致）
    // 批A2：tencent 也是真实通道意图（isMock=false），凭据缺失运行时拒发
    this.isMock =
      (resolveProvider() !== 'gateway' && resolveProvider() !== 'tencent') ||
      process.env.SMS_STUB_ALLOWED === 'true';
  }

  /** 批A2：provider=tencent 时的委托策略（构造只 new 不校验凭据，P1-1 不 throw） */
  private readonly tencentDelegate = new TencentSmsStrategy();

  async sendCode(input: OtpSendInput): Promise<OtpSendOutput> {
    // 批A2：provider=tencent 委托 TencentSmsStrategy（同 OtpStrategy 接口，键/TTL 同款）
    if (resolveProvider() === 'tencent') {
      if (process.env.SMS_STUB_ALLOWED === 'true') {
        return this.sendStub(input);
      }
      await assertSmsDailyBudget(); // 批A2-1：真实通道统一日预算熔断（stub 不计数）
      return this.tencentDelegate.sendCode(input);
    }
    if (!this.isMock) {
      // 运行时凭据校验（P1-1：构造期不校验，此处拒发；逃生门回退 stub 语义不变）
      if (resolveGatewayOrEscape() === 'stub') {
        return this.sendStub(input);
      }
      await assertSmsDailyBudget(); // 批A2-1：真实通道统一日预算熔断（stub 不计数）
      await this.sendViaGateway(input);
      return { expireIn: CODE_TTL_SECONDS };
    }
    return this.sendStub(input);
  }

  /** 真实网关通道：生成随机码落 Redis，再调网关发送 */
  private async sendViaGateway(input: OtpSendInput): Promise<void> {
    const config = readSmsGatewayConfig();
    if (!config) {
      // 构造期不校验（P1-1），此处是发送时配置被改坏等防御兜底，同样拒发
      // R17 拒发计数：not_configured 分桶
      logger.warn({
        msg: 'SMS_SEND_REFUSED',
        reason: 'not_configured',
        provider: 'gateway',
        phone: maskSmsPhone(input.target),
        note: 'gateway config missing at send time; refusing OTP (503 E-SMS-001)',
      });
      throw smsUnavailableException('SMS gateway config missing at send time');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    await redis.set(key, code, 'EX', CODE_TTL_SECONDS);

    const text = `Your MeiMart verification code is: ${code}. It expires in 5 minutes.`;
    try {
      const { messageId } = await sendSmsViaGateway(config, input.target, text);

      logger.info({
        msg: '[SMS_GATEWAY] sendCode',
        phone: maskSmsPhone(input.target),
        scene: input.scene,
        messageId: messageId ?? null,
      });
    } catch (e) {
      // R17 拒发计数：provider_error 分桶（网关网络/HTTP 错误，验证码已落 Redis 但未送达）
      logger.warn({
        msg: 'SMS_SEND_REFUSED',
        reason: 'provider_error',
        provider: 'gateway',
        phone: maskSmsPhone(input.target),
        scene: input.scene,
        error: (e as Error).message,
      });
      // P1-2（审查修复）：网关运行时错误同样不裸冒——SmsGatewayError 等非 HTTP
      // 异常会经 all-exceptions.filter 落泛化 500 E-COMMON-002，客户端无从分辨；
      // 包装为 503 E-SMS-001，语义=「验证码服务暂不可用，请稍后重试」
      if (e instanceof HttpException) throw e;
      throw smsUnavailableException(
        `gateway send failed: ${(e as Error).name}`,
      );
    }
  }

  /** dev stub：固定验证码落 Redis，日志标 [SMS_STUB]（W1 行为保持） */
  private async sendStub(input: OtpSendInput): Promise<OtpSendOutput> {
    const stubCode = process.env.SMS_STUB_CODE ?? '123456';
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    await redis.set(key, stubCode, 'EX', CODE_TTL_SECONDS);

    logger.info({
      msg: '[SMS_STUB] sendCode',
      phone: maskSmsPhone(input.target),
      scene: input.scene,
      // M-5：不输出 code 原文。OTP_DEBUG_CODE=1 时显式打开（仅 dev debug）
      ...(process.env.OTP_DEBUG_CODE === '1' ? { codeDebug: stubCode } : {}),
      note: 'stub code in Redis (SMS_STUB_CODE env or default 123456)',
    });
    return { expireIn: CODE_TTL_SECONDS };
  }

  async verifyCode(input: OtpVerifyInput): Promise<OtpVerifyOutput> {
    // 批A2：tencent 通道的验证码也落同一 Redis 键结构，本类 verifyCode 直接通用，
    // 无需委托（键 = otp:sms:{scene}:{target}，TencentSmsStrategy 写入时同构）
    const key = `${KEY_PREFIX}${input.scene}:${input.target}`;
    const stored = await redis.get(key);

    if (!stored) {
      return { valid: false, reason: 'EXPIRED' };
    }

    if (stored !== input.code) {
      return { valid: false, reason: 'WRONG_CODE' };
    }

    // 验证成功后删除（一次性）
    await redis.del(key);
    logger.info({
      msg: '[SMS] verifyCode',
      phone: maskSmsPhone(input.target),
      scene: input.scene,
      result: 'PASS',
    });
    return { valid: true };
  }
}
