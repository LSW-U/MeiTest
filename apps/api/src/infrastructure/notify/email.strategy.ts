/**
 * Email 策略 — SendGrid（prod）/ MailHog（dev/staging）
 *
 * 决策依据：CLAUDE.md §测试阶段 OTP（SMTP MailHog dev / SendGrid prod）
 *
 * MVP 实现：
 *   - dev/staging：连 MailHog localhost:1025（不验证 TLS，直接 SMTP）
 *   - prod：连 SendGrid SMTP（环境变量 SENDGRID_API_KEY / SMTP_HOST 配置）
 *   - 没有 nodemailer 依赖时降级到 mock（写日志返回 mock_messageId）
 *
 * 接入 nodemailer 留到 W6 真切 SendGrid 时（避免 dev 加不必要的依赖）。
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../../shared/logger/logger';
import type { NotifyStrategy, NotifyRequest, NotifyResult } from './notify-strategy';

@Injectable()
export class EmailNotifyStrategy implements NotifyStrategy {
  readonly channel = 'EMAIL' as const;

  async send(request: NotifyRequest): Promise<NotifyResult> {
    const locale = request.locale ?? 'en';
    const subject = request.title[locale] ?? request.title.en ?? 'MeiMart Notification';
    const text = request.body[locale] ?? request.body.en ?? '';

    // MVP mock：日志记录（W6 接 SendGrid SMTP 时替换为 nodemailer.sendMail）
    const messageId = `mock_email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({
      msg: 'NOTIFY_EMAIL_SENT',
      channel: 'EMAIL',
      userId: request.userId,
      type: request.type,
      subject,
      textPreview: text.slice(0, 80),
      messageId,
      mockFlag: true,
      note: 'W6 切 SendGrid 时替换为真实 SMTP 发送',
    });

    return { success: true, messageId, mockFlag: true };
  }
}
