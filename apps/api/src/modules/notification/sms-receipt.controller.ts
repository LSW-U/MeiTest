/**
 * SMS 回执 Webhook 端点骨架（批A R16 · 预研笔记⑤步骤9）
 *
 * 背景：网关选型未定（新②解挂前不定商）→ **只留接口不实现网关逻辑**：
 *   - 端点路由已就位（POST /api/v1/common/webhooks/sms-receipt，公开端点，网关回调无 JWT）
 *   - 签名校验钩子 verifySmsReceiptSignature（HMAC-SHA256 + timingSafeEqual，fail-closed：
 *     secret 未配置/签名缺失/不匹配一律拒 401 —— Q4 防伪造）
 *   - 配置开关 SMS_RECEIPT_WEBHOOK_ENABLED 默认关：关时直接忽略（不验签不落库），
 *     网关侧重试无害；开关开 + 验签过 → 目前仅日志留痕（recorded:false），
 *     等选型后按实测网关的回执字段（messageId→status 映射）补落库。
 *
 * 先例参照：modules/notification/expo-receipts.ts（批N4，回执拉取式）——SMS 网关多为
 * 回调式（webhook push），故走端点而非拉取；拉取式网关选定后可在此文件旁挂 client。
 *
 * 已知限制（选型后补全项，见 verifySmsReceiptSignature TODO）：
 *   - 当前 body 经 express json parser 解析，键序可能重排，严格 raw-body 验签需
 *     NestFactory.create(AppModule, { rawBody: true }) + raw 载荷验签（main.ts 一行改动）；
 *     骨架期用 JSON.stringify(body) 近似（开关默认关，无安全暴露面）。
 *   - 签名 header 名 / 回执 payload 形态均待网关选型定（现约定 x-sms-signature，
 *     sha256= 前缀可选剥离，兼容常见网关习惯）。
 */
import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../../shared/logger/logger';
import { Public } from '../../shared/decorators/public.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

/** 回执开关键（默认关；真实凭据只进 GitHub Secret，R7） */
export const SMS_RECEIPT_WEBHOOK_ENABLED_ENV = 'SMS_RECEIPT_WEBHOOK_ENABLED';
/** 回执验签 secret 键（HMAC-SHA256；未配置时钩子 fail-closed 全拒） */
export const SMS_RECEIPT_WEBHOOK_SECRET_ENV = 'SMS_RECEIPT_WEBHOOK_SECRET';

/** 错误码（E-SMS 段 007/008 续批A 编排；001-006 已被策略占用） */
export const E_SMS_007_DISABLED = 'E-SMS-007';
export const E_SMS_008_BAD_SIGNATURE = 'E-SMS-008';

/** 开关是否打开（默认关；env 只在请求时读，便于测试与运维热切） */
export function isSmsReceiptWebhookEnabled(): boolean {
  return process.env[SMS_RECEIPT_WEBHOOK_ENABLED_ENV] === 'true';
}

/**
 * 签名校验钩子（Q4：防伪造）
 *
 * HMAC-SHA256(secret, rawBody) 与签名 header 比对（timingSafeEqual 防时序侧信道）。
 * fail-closed：secret 未配置 / 签名缺失 / 长度不符 / 不匹配 → 一律 false。
 *
 * TODO(R16 选型后)：接入 raw body（main.ts rawBody: true）替换近似 stringify 入参，
 * 并按实测网关调整签名 header 名与哈希前缀约定。
 */
export function verifySmsReceiptSignature(
  rawBody: string,
  signature: string | null | undefined,
): boolean {
  const secret = process.env[SMS_RECEIPT_WEBHOOK_SECRET_ENV];
  if (!secret?.trim()) return false;
  if (!signature) return false;
  const provided = signature.replace(/^sha256=/, '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 回执接收骨架：开关关 → 忽略（E-SMS-007）；开关开 → 验签 →（选型后）落库。
 * 现阶段不做 messageId 状态入库——网关回执字段未知，避免伪实现。
 */
@Controller('api/v1/common/webhooks/sms-receipt')
export class SmsReceiptWebhookController {
  /** 网关回调：无 JWT（@Public），无 CSRF（无 admin cookie 自动放行），无 @RateLimit（网关侧重试不应被限流计数） */
  @Public()
  @Audit({ resource: 'SmsReceipt', skip: true })
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ success: boolean; recorded: boolean; code?: string }> {
    if (!isSmsReceiptWebhookEnabled()) {
      logger.warn({
        msg: 'SMS_RECEIPT_WEBHOOK_IGNORED',
        reason: 'DISABLED',
        note: `set ${SMS_RECEIPT_WEBHOOK_ENABLED_ENV}=true + ${SMS_RECEIPT_WEBHOOK_SECRET_ENV} after gateway selection (R16)`,
      });
      return { success: false, recorded: false, code: E_SMS_007_DISABLED };
    }

    // 骨架期近似 raw body（见文件头 TODO：选型后换 rawBody: true 严格验签）
    const raw = JSON.stringify(body ?? null);
    const signature = headers['x-sms-signature'] ?? headers['x-signature'] ?? null;
    if (!verifySmsReceiptSignature(raw, signature)) {
      logger.warn({ msg: 'SMS_RECEIPT_WEBHOOK_REJECTED', reason: 'BAD_SIGNATURE' });
      throw new UnauthorizedException({
        code: E_SMS_008_BAD_SIGNATURE,
        message: 'sms receipt signature invalid',
      });
    }

    // TODO(R16 选型后)：按实测网关解析 messageId/status 落库（参照 expo-receipts.ts 状态语义），
    // A2 达标口径=回执状态 + 60s 从 send 起算。
    logger.info({
      msg: 'SMS_RECEIPT_WEBHOOK_RECEIVED',
      note: 'skeleton: signature verified, storage pending gateway selection (R16)',
    });
    return { success: true, recorded: false };
  }
}
