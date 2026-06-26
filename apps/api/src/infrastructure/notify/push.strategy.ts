/**
 * Push 策略 — FCM（Android）/ APNs（iOS）/ dev stub
 *
 * 决策依据：CLAUDE.md §技术栈 + W4 任务（Push/邮件/WhatsApp stub）
 *
 * MVP 实现：dev stub，日志记录推送内容。W6+ 接入 FCM/APNs SDK 时替换为真实发送。
 *
 * Push 通道需要 client device token（FCM token / APNs device token），
 * 当前 schema.prisma 还没存 deviceToken，需要 W4/W5 加 User.deviceTokens 表。
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import type { NotifyStrategy, NotifyRequest, NotifyResult } from './notify-strategy';

@Injectable()
export class PushNotifyStrategy implements NotifyStrategy {
  readonly channel = 'PUSH' as const;

  async send(request: NotifyRequest): Promise<NotifyResult> {
    const locale = request.locale ?? 'en';
    const title = request.title[locale] ?? request.title.en ?? '';
    const body = request.body[locale] ?? request.body.en ?? '';

    // MVP stub：W6+ 接入 firebase-admin（FCM）+ apn（APNs）时替换
    const messageId = `mock_push_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({
      msg: 'NOTIFY_PUSH_SENT',
      channel: 'PUSH',
      userId: request.userId,
      type: request.type,
      title,
      bodyPreview: body.slice(0, 80),
      data: request.data,
      messageId,
      mockFlag: true,
      note: 'W6+ 接 FCM/APNs 时替换；schema.prisma 需加 User.deviceTokens 表',
    });

    return { success: true, messageId, mockFlag: true };
  }
}
