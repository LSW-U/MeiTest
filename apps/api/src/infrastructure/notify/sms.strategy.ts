/**
 * SMS 通知策略 — 业务通知（非 OTP）stub / 真实网关双通道（批A R18+R21 切真）
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP + 批A-预研笔记-20260914.md ①#3/④/⑤步骤4
 *
 * 双通道语义（与 otp/sms.strategy 的 fail-fast 相反，本策略绝不抛错）：
 *   - 开关关（默认，SMS_NOTIFY_ENABLED != 'true'）：保持 stub 行为，日志标 [SMS_STUB]
 *   - 开关开：真实网关发送（复用 otp/sms-gateway.client.ts 同一 provider 配置）
 *
 * R18 三层容错（策略内部也不抛，返回 success:false 降级）：
 *   1. 策略内部：所有失败路径（缺配置/缺号/查库失败/超配额/网关失败/Redis 异常）
 *      一律 warn 日志（reason 分桶，供 R17 拒发计数）+ success:false，不 throw
 *   2. notify.factory.send 已有 try/catch 兜底
 *   3. order.service 等调用方已有 try/catch（失败容忍）
 *
 * R21 开关+日配额：
 *   - SMS_NOTIFY_ENABLED=true 才走真实发送
 *   - SMS_NOTIFY_DAILY_LIMIT 日配额（未配置默认 1000），Redis INCR 当日过期计数，
 *     键命名空间 sms:notify:daily:{UTC 日期}
 *
 * 注：OTP 验证码（注册/登录）走 infrastructure/otp 的 SmsStrategy，不走这里。
 */
import { Injectable } from '@nestjs/common';
import { redis } from '../../shared/cache';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { readSmsGatewayConfig, sendSmsViaGateway } from '../otp/sms-gateway.client';
import { maskSmsPhone } from '../otp/sms.strategy';
import { resolveProvider } from '../otp/sms.strategy';
import type { NotifyStrategy, NotifyRequest, NotifyResult } from './notify-strategy';

/** 日配额默认值（SMS_NOTIFY_DAILY_LIMIT 未配置或非法时兜底，费控不失效） */
const DEFAULT_DAILY_LIMIT = 1000;

/** 配额键 TTL：2 天（跨 UTC 日余量，避免临界日不过期堆积） */
const QUOTA_KEY_TTL_SECONDS = 2 * 24 * 3600;

/** 日配额 Redis 键（命名空间 sms:notify:*，预研笔记④） */
export function smsNotifyQuotaKey(date: string): string {
  return `sms:notify:daily:${date}`;
}

/** 当日 UTC 日期（配额按自然日，UTC 与网关账单日对齐即可，不追 Asia/Dili 业务日） */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class SmsNotifyStrategy implements NotifyStrategy {
  readonly channel = 'SMS' as const;

  async send(request: NotifyRequest): Promise<NotifyResult> {
    const locale = request.locale ?? 'en';
    const text = request.body[locale] ?? request.body.en ?? '';

    // 开关关 → 保持 stub（W1 行为，mockFlag 日志留痕）
    if (process.env.SMS_NOTIFY_ENABLED !== 'true') {
      return this.sendStub(request, text);
    }

    try {
      return await this.sendReal(request, text);
    } catch (e) {
      // R18：绝不 fail-fast —— 最后一道兜底（Redis 异常等未分类错误也降级不外抛）
      logger.warn({
        msg: 'NOTIFY_SMS_DEGRADED',
        reason: 'UNEXPECTED_ERROR',
        userId: request.userId,
        type: request.type,
        error: (e as Error).message,
      });
      return { success: false, mockFlag: false, error: `E-SMS-006: ${(e as Error).message}` };
    }
  }

  /** stub 通道：日志标 [SMS_STUB]（W1 行为保持，SMS_NOTIFY_ENABLED 关闭时走这里） */
  private sendStub(request: NotifyRequest, text: string): NotifyResult {
    const messageId = `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({
      msg: 'NOTIFY_SMS_SENT',
      channel: 'SMS',
      userId: request.userId,
      type: request.type,
      textPreview: text.slice(0, 80),
      messageId,
      mockFlag: true,
      tag: '[SMS_STUB]',
      note: 'SMS_NOTIFY_ENABLED != true; stub notify (set true + gateway env to switch on)',
    });
    return { success: true, messageId, mockFlag: true };
  }

  /**
   * 真实网关通道：查号 → 日配额 → 网关发送
   * 任一步失败 → warn（reason 分桶）+ success:false，绝不抛（R18）
   */
  private async sendReal(request: NotifyRequest, text: string): Promise<NotifyResult> {
    const base = { userId: request.userId, type: request.type };

    // 1. provider 解析（批A2-1 任务书 #3：兼容 tencent——开关开后 provider=tencent
    //    时不再误走 gateway 发送（会拿 gateway env 缺失/错发），降级不抛（R18）。
    //    开关仍默认关，stub 默认行为不变。tencent 真发通道留后续批（notify 走
    //    文本模板，与 OTP 数字模板不同），当前兼容分支=识别并降级不误发。
    const provider = resolveProvider();
    if (provider === 'tencent') {
      logger.warn({
        msg: 'NOTIFY_SMS_DEGRADED',
        reason: 'TENCENT_NOTIFY_NOT_SUPPORTED',
        ...base,
        note: 'SMS_PROVIDER=tencent detected; notify real-send via tencent not wired yet (A2 后续批), degrading without send',
      });
      return { success: false, mockFlag: false, error: 'E-SMS-002: notify tencent channel not wired yet' };
    }

    // 2. 网关配置（复用 otp 同一 provider env；缺 → 降级不抛）
    const config = readSmsGatewayConfig();
    if (!config) {
      logger.warn({ msg: 'NOTIFY_SMS_DEGRADED', reason: 'GATEWAY_CONFIG_MISSING', ...base });
      return { success: false, mockFlag: false, error: 'E-SMS-002: SMS gateway not configured' };
    }

    // 3. userId → phone 查库（User.phone @unique，schema.prisma:245；缺号/查库失败 → 降级）
    let phone: string | undefined;
    try {
      const user = await db.user.findUnique({
        where: { id: request.userId },
        select: { phone: true },
      });
      phone = user?.phone ?? undefined;
    } catch (e) {
      logger.warn({
        msg: 'NOTIFY_SMS_DEGRADED',
        reason: 'USER_LOOKUP_FAILED',
        ...base,
        error: (e as Error).message,
      });
      return { success: false, mockFlag: false, error: 'E-SMS-003: user lookup failed' };
    }
    if (!phone) {
      logger.warn({ msg: 'NOTIFY_SMS_DEGRADED', reason: 'USER_PHONE_MISSING', ...base });
      return { success: false, mockFlag: false, error: 'E-SMS-004: user has no phone' };
    }

    // 4. 日配额（INCR 当日过期；触顶拒发不发送，拒发也计数偏保守防突发放大）
    const limit = Number(process.env.SMS_NOTIFY_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
    const quotaKey = smsNotifyQuotaKey(todayUtc());
    const count = await redis.incr(quotaKey);
    if (count === 1) {
      await redis.expire(quotaKey, QUOTA_KEY_TTL_SECONDS);
    }
    if (count > limit) {
      logger.warn({
        msg: 'NOTIFY_SMS_QUOTA_EXCEEDED',
        reason: 'DAILY_QUOTA_EXCEEDED',
        ...base,
        count,
        limit,
      });
      return { success: false, mockFlag: false, error: 'E-SMS-005: daily SMS notify quota exceeded' };
    }

    // 5. 网关发送（SmsGatewayError → 降级不抛）
    try {
      const { messageId } = await sendSmsViaGateway(config, phone, text);
      logger.info({
        msg: '[SMS_NOTIFY] sent',
        channel: 'SMS',
        userId: request.userId,
        type: request.type,
        phone: maskSmsPhone(phone), // N-2：日志不打明文 phone
        messageId: messageId ?? null,
        quotaCount: count,
      });
      return { success: true, messageId, mockFlag: false };
    } catch (e) {
      logger.warn({
        msg: 'NOTIFY_SMS_DEGRADED',
        reason: 'GATEWAY_SEND_FAILED',
        ...base,
        phone: maskSmsPhone(phone),
        error: (e as Error).message,
      });
      return { success: false, mockFlag: false, error: `E-SMS-006: ${(e as Error).message}` };
    }
  }
}
