/**
 * SMS 策略 — Timor Telecom / Telkomcel（W6 切真）/ dev stub
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP（SMS 测试 stub 固定 123456 / W6 切东帝汶本地）
 *
 * MVP 实现：dev stub，日志标 [SMS_STUB]。W6 切本地服务商时实现真实发送。
 *
 * 注：OTP 验证码（注册/登录）走 infrastructure/otp 的 SmsStrategy，不走这里。
 *     本策略用于业务通知（订单状态、配送通知等）。
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import type { NotifyStrategy, NotifyRequest, NotifyResult } from './notify-strategy';

@Injectable()
export class SmsNotifyStrategy implements NotifyStrategy {
  readonly channel = 'SMS' as const;

  async send(request: NotifyRequest): Promise<NotifyResult> {
    const locale = request.locale ?? 'en';
    const text = request.body[locale] ?? request.body.en ?? '';

    // MVP stub：固定 mock，日志标 [SMS_STUB]
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
      note: 'W6 切 Timor Telecom / Telkomcel 时替换为真实发送',
    });

    return { success: true, messageId, mockFlag: true };
  }
}
