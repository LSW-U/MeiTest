/**
 * WhatsApp 策略 — WhatsApp Business API（W6 切真）/ dev stub
 *
 * 决策依据：CLAUDE.md §外部服务 + W-M-C-T 流程 3 W4
 *
 * MVP 实现：dev stub，固定返回成功。W6 拿到主体后申请 WhatsApp Business API。
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import type { NotifyStrategy, NotifyRequest, NotifyResult } from './notify-strategy';

@Injectable()
export class WhatsAppNotifyStrategy implements NotifyStrategy {
  readonly channel = 'WHATSAPP' as const;

  async send(request: NotifyRequest): Promise<NotifyResult> {
    const locale = request.locale ?? 'en';
    const text = request.body[locale] ?? request.body.en ?? '';

    // MVP stub：W6 接 WhatsApp Business API 时替换
    const messageId = `mock_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({
      msg: 'NOTIFY_WHATSAPP_SENT',
      channel: 'WHATSAPP',
      userId: request.userId,
      type: request.type,
      textPreview: text.slice(0, 80),
      messageId,
      mockFlag: true,
      note: 'W6 拿到主体后申请 WhatsApp Business API',
    });

    return { success: true, messageId, mockFlag: true };
  }
}
