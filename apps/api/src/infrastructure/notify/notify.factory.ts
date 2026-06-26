/**
 * Notify Factory — 通知发送工厂
 *
 * 决策依据：CLAUDE.md §外部服务（interface 抽象，dev/staging 全 mock）
 *
 * 用法：
 *   const result = await notifyFactory.send({
 *     userId: 'xxx',
 *     channel: 'EMAIL',
 *     type: 'ORDER_STATUS',
 *     title: { en: 'Order Confirmed', zh: '订单已确认' },
 *     body: { en: '...', zh: '...' },
 *     data: { orderId: 'xxx' },
 *   });
 *
 * 多通道发送（如同时发邮件 + 推送）：
 *   await notifyFactory.sendMulti(request, ['EMAIL', 'PUSH']);
 */
import { Injectable, Inject } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import {
  EmailNotifyStrategy,
  SmsNotifyStrategy,
  PushNotifyStrategy,
  WhatsAppNotifyStrategy,
} from '.';
import type { NotifyChannel, NotifyRequest, NotifyResult, NotifyStrategy } from './notify-strategy';

@Injectable()
export class NotifyFactory {
  private strategies: Map<NotifyChannel, NotifyStrategy>;

  constructor(
    @Inject(EmailNotifyStrategy) private readonly email: EmailNotifyStrategy,
    @Inject(SmsNotifyStrategy) private readonly sms: SmsNotifyStrategy,
    @Inject(PushNotifyStrategy) private readonly push: PushNotifyStrategy,
    @Inject(WhatsAppNotifyStrategy) private readonly whatsapp: WhatsAppNotifyStrategy,
  ) {
    this.strategies = new Map<NotifyChannel, NotifyStrategy>([
      ['EMAIL', this.email],
      ['SMS', this.sms],
      ['PUSH', this.push],
      ['WHATSAPP', this.whatsapp],
    ]);
  }

  /** 单通道发送 */
  async send(request: NotifyRequest): Promise<NotifyResult> {
    const strategy = this.strategies.get(request.channel);
    if (!strategy) {
      return {
        success: false,
        mockFlag: false,
        error: `Unsupported notify channel: ${request.channel}`,
      };
    }

    try {
      return await strategy.send(request);
    } catch (e) {
      logger.error({
        msg: 'NOTIFY_SEND_ERROR',
        channel: request.channel,
        userId: request.userId,
        type: request.type,
        error: (e as Error).message,
      });
      return {
        success: false,
        mockFlag: false,
        error: (e as Error).message,
      };
    }
  }

  /** 多通道并发发送（一个失败不影响其他） */
  async sendMulti(
    request: Omit<NotifyRequest, 'channel'>,
    channels: NotifyChannel[],
  ): Promise<Record<NotifyChannel, NotifyResult>> {
    const results = await Promise.all(
      channels.map(async (channel) => [
        channel,
        await this.send({ ...request, channel }),
      ] as const),
    );
    return Object.fromEntries(results) as Record<NotifyChannel, NotifyResult>;
  }
}
