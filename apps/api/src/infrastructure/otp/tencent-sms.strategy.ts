/**
 * 腾讯云国际短信策略（批A2 · 真实 SMS 路线 A）
 *
 * 决策依据：任务书-批A2-腾讯云SMS真实接入.md（执行权威）+ SMS-OTP-TIMOR-LESTE-PLAN.md §5.2
 *   - 路线 A：官方 SDK（tencentcloud-sdk-nodejs-sms）处理 TC3-HMAC-SHA256 动态签名，
 *     现有 sms-gateway.client 的静态 header 网关装不进腾讯云（卡点 ①）
 *   - 中国站国际短信：无需资质申请、允许不携带签名（SignName 可留空）
 *   - 东帝汶 +670：号码由上游 unified-auth E.164 归一化后传入，此处兜底补 '+'
 *
 * P1-1 教训（批A 审查，必须遵守）：**构造期只定意图不 throw** —— otp.factory 是
 * 模块作用域实例化路径，构造期抛错会让整个 API 生产启动即死（违背 R8「不退进程，
 * 爆炸半径=登录」）。本文件三重保证：
 *   1. 模块顶层只 import SDK，不 new Client（SDK import 无凭据副作用）
 *   2. TencentSmsStrategy 构造器零逻辑，isMock 硬编码 false（provider=tencent 即真实意图）
 *   3. Client 在 sendCode 运行时用当次 env 构造；缺凭据 → smsUnavailableException()
 *      503 E-SMS-001 运行时拒发（与 gateway 通道同款语义）
 *
 * env（真实值只进 GitHub Secret，R7，不落仓库）：
 *   - TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY   API 密钥（必填）
 *   - TENCENT_SMS_SDK_APP_ID                            短信应用 SdkAppId（必填，1400xxxxxx）
 *   - TENCENT_SMS_TEMPLATE_ID                           国际模板 ID（必填，6 位纯数字变量）
 *   - TENCENT_SMS_REGION                                地域（默认 ap-guangzhou）
 *   - TENCENT_SMS_SIGN_NAME                             签名（国际短信允许不携带，可留空）
 *   - TENCENT_SMS_SENDER_ID                             独立 Sender ID（未报备留空，用公共 SenderId）
 *
 * 四项必填缺一 → readTencentSmsConfig() 返回 null，调用方（本策略 sendCode /
 * sms-startup-check 软告警）分别做运行时拒发 / 启动告警。
 */
import * as tencentSdk from 'tencentcloud-sdk-nodejs-sms';
import { HttpException } from '@nestjs/common';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { maskSmsPhone } from './sms-gateway.client';
import { smsUnavailableException, CODE_TTL_SECONDS, KEY_PREFIX } from './sms.strategy';
import type {
  OtpStrategy,
  OtpSendInput,
  OtpSendOutput,
  OtpVerifyInput,
  OtpVerifyOutput,
} from './otp-strategy';

export interface TencentSmsConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  templateId: string;
  region: string;
  signName?: string;
  senderId?: string;
}

/**
 * 读取腾讯云凭据配置；四项必填 env 缺一 → null（调用方 fail-fast 拒发）
 *
 * 每次调用现读（sendCode 受频控约束频率低，无性能问题），测试切 env 无需缓存重置；
 * Client 也在发送时现构造，配置改坏后下一发即感知。
 */
export function readTencentSmsConfig(): TencentSmsConfig | null {
  const secretId = process.env.TENCENT_SMS_SECRET_ID;
  const secretKey = process.env.TENCENT_SMS_SECRET_KEY;
  const sdkAppId = process.env.TENCENT_SMS_SDK_APP_ID;
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID;
  if (!secretId || !secretKey || !sdkAppId || !templateId) return null;
  return {
    secretId,
    secretKey,
    sdkAppId,
    templateId,
    region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
    // 国际短信允许不携带签名（382/37799）；空串按未配置处理
    signName: process.env.TENCENT_SMS_SIGN_NAME || undefined,
    senderId: process.env.TENCENT_SMS_SENDER_ID || undefined,
  };
}

/**
 * 腾讯云 SMS OTP 策略（provider=tencent 时由 SmsStrategy 委托，见 sms.strategy.ts）
 *
 * Redis 键 / TTL / verifyCode 语义与 SmsStrategy 完全同款（otp:sms:{scene}:{target}，
 * 5 分钟 TTL，验证后一次性消费）——验证链路不感知 provider。
 */
export class TencentSmsStrategy implements OtpStrategy {
  readonly channel = 'SMS' as const;
  /** provider=tencent 即真实通道意图；凭据缺失在 sendCode 运行时拒发（P1-1，构造不抛） */
  readonly isMock = false;

  async sendCode(input: OtpSendInput): Promise<OtpSendOutput> {
    const config = readTencentSmsConfig();
    if (!config) {
      // R17 拒发计数：not_configured 分桶（运行时拒发前留痕）
      logger.warn({
        msg: 'SMS_SEND_REFUSED',
        reason: 'not_configured',
        provider: 'tencent',
        note: 'tencent credentials missing; OTP send refused with 503 E-SMS-001',
      });
      throw smsUnavailableException(
        'TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY / TENCENT_SMS_SDK_APP_ID / TENCENT_SMS_TEMPLATE_ID not fully configured',
      );
    }

    // 上游 unified-auth 已做 E.164 归一化；此处兜底补 '+'（防御裸号段直入）。
    // Redis 键用归一化后的号码（与 verifyCode 入参同构；上游两处都传归一化值）
    const e164 = input.target.startsWith('+') ? input.target : `+${input.target}`;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const key = `${KEY_PREFIX}${input.scene}:${e164}`;
    await redis.set(key, code, 'EX', CODE_TTL_SECONDS);

    try {
      const client = new tencentSdk.sms.v20210111.Client({
        credential: { secretId: config.secretId, secretKey: config.secretKey },
        region: config.region,
      });
      const resp = await client.SendSms({
        PhoneNumberSet: [e164],
        SmsSdkAppId: config.sdkAppId,
        TemplateId: config.templateId,
        TemplateParamSet: [code],
        // 国际短信允许不携带签名：未配置不下发该字段（不用空串占位）
        ...(config.signName ? { SignName: config.signName } : {}),
        ...(config.senderId ? { SenderId: config.senderId } : {}),
      });

      const status = resp.SendStatusSet?.[0];
      if (!status || status.Code !== 'Ok') {
        // 业务层失败（API 2xx 但 SendStatus.Code != Ok）：按 provider_error 拒发
        logger.warn({
          msg: 'SMS_SEND_REFUSED',
          reason: 'provider_error',
          provider: 'tencent',
          phone: maskSmsPhone(e164),
          scene: input.scene,
          statusCode: status?.Code ?? 'NO_STATUS',
          statusMessage: status?.Message ?? null,
        });
        throw smsUnavailableException(`tencent send failed: ${status?.Code ?? 'NO_STATUS'}`);
      }

      logger.info({
        msg: '[SMS_TENCENT] sendCode',
        phone: maskSmsPhone(e164),
        scene: input.scene,
        serialNo: status.SerialNo ?? null,
        fee: status.Fee ?? null,
      });
    } catch (e) {
      // P1-2 同款语义：SDK 网络/签名错误不裸冒（会落泛化 500 E-COMMON-002），
      // 包装 503 E-SMS-001「验证码服务暂不可用」；已包装的 HttpException 原样上抛
      if (e instanceof HttpException) throw e;
      logger.warn({
        msg: 'SMS_SEND_REFUSED',
        reason: 'provider_error',
        provider: 'tencent',
        phone: maskSmsPhone(e164),
        scene: input.scene,
        error: (e as Error).message,
      });
      throw smsUnavailableException(`tencent send failed: ${(e as Error).name}`);
    }

    return { expireIn: CODE_TTL_SECONDS };
  }

  /** 与 SmsStrategy.verifyCode 同键同语义（一次性消费）；target 须与发码时同归一化形态 */
  async verifyCode(input: OtpVerifyInput): Promise<OtpVerifyOutput> {
    const e164 = input.target.startsWith('+') ? input.target : `+${input.target}`;
    const key = `${KEY_PREFIX}${input.scene}:${e164}`;
    const stored = await redis.get(key);

    if (!stored) {
      return { valid: false, reason: 'EXPIRED' };
    }
    if (stored !== input.code) {
      return { valid: false, reason: 'WRONG_CODE' };
    }

    await redis.del(key);
    logger.info({
      msg: '[SMS] verifyCode',
      phone: maskSmsPhone(e164),
      scene: input.scene,
      result: 'PASS',
    });
    return { valid: true };
  }
}
