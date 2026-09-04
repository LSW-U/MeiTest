/**
 * Notification Module — 后台通知/推送管理（admin-web 优化方案 批次2 2026-08-29）
 *
 * 提供：
 *   - AdminNotificationService（群发/指定写 Notification 表 + NotifyFactory PUSH stub）
 *   - AdminNotificationController（POST 发送 + GET 历史，前缀 /api/v1/admin/notifications）
 *
 * 依赖：
 *   - Prisma 全局 db 单例（shared/db，不注入）
 *   - NotifyFactory + 4 策略（PUSH 是 dev stub；与 order.module 同款注册 NotifyFactoryToken）
 *
 * 注：客户端通知拉取仍走 UserModule 的 NotificationController（/client/notifications），
 *   本模块只做后台「发送」侧，不复用 UserService（避免 SUPER_ADMIN 调 @Roles('CUSTOMER') 端点的权限冲突）。
 */
import { Module } from '@nestjs/common';
import { AdminNotificationService } from './admin-notification.service';
import { AdminNotificationController } from './admin-notification.controller';
import {
  NotifyFactory,
  EmailNotifyStrategy,
  SmsNotifyStrategy,
  PushNotifyStrategy,
  WhatsAppNotifyStrategy,
} from '../../infrastructure';

@Module({
  controllers: [AdminNotificationController],
  providers: [
    AdminNotificationService,
    // Notify 策略（与 order.module 同款注册，PUSH 是 dev stub）
    EmailNotifyStrategy,
    SmsNotifyStrategy,
    PushNotifyStrategy,
    WhatsAppNotifyStrategy,
    NotifyFactory,
    // 显式声明 DI token，避免 tsx esbuild 不生成 emitDecoratorMetadata 导致 Inject token 无法解析
    { provide: 'NotifyFactoryToken', useExisting: NotifyFactory },
  ],
})
export class NotificationModule {}
