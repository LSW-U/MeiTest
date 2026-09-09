/**
 * Notification Module — 通知/推送管理（admin-web 优化方案 批次2 + 批A 2026-09-09 通知基础设施）
 *
 * 提供：
 *   - DeviceTokenService + Client/Rider DeviceTokenController（批A A1：token 注册/注销双端点）
 *   - NotificationService（批A A3：从 user.service 抽出的 client 通知四端点实现 + rider 端点复用）
 *   - NotificationEventService（批A A4：七类业务事件挂点 → 站内信 + PUSH）
 *   - AdminNotificationService + AdminNotificationController（批A A5：批次化发送/历史/retry）
 *   - NotificationPushProcessor（批A A5：BullMQ 通知推送消费者，分块 100）
 *
 * 依赖：
 *   - Prisma 全局 db 单例（shared/db，不注入）
 *   - NotifyFactory + 4 策略（PUSH 批A A2 切 Expo 真实现，dev 无凭证 stub 降级）
 *   - BullMQ NOTIFICATION_QUEUE（批A A5：admin 批量通知异步分块推送）
 *
 * 注：client 通知拉取控制器仍在 UserModule（/client/notifications 路由不动，行为回归），
 *   本模块持有共享实现 NotificationService；rider 侧（/rider/notifications + /rider/device-tokens）
 *   与 DeviceToken/事件挂点都在本模块。
 */
import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { AdminNotificationService } from './admin-notification.service';
import { AdminNotificationController } from './admin-notification.controller';
import { NotificationService } from './notification.service';
import { NotificationEventService } from './notification-event.service';
import { DeviceTokenService } from './device-token.service';
import { NotificationPushProcessor } from './notification-push.processor';
import {
  ClientDeviceTokenController,
  RiderDeviceTokenController,
} from './device-token.controller';
import { RiderNotificationController } from './rider-notification.controller';
import {
  NotifyFactory,
  EmailNotifyStrategy,
  SmsNotifyStrategy,
  PushNotifyStrategy,
  WhatsAppNotifyStrategy,
} from '../../infrastructure';
import { NOTIFICATION_QUEUE } from '../../shared/queue';

@Module({
  imports: [
    // 批A A5：admin 批量通知异步推送队列
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [
    AdminNotificationController,
    ClientDeviceTokenController,
    RiderDeviceTokenController,
    RiderNotificationController,
  ],
  providers: [
    AdminNotificationService,
    NotificationService,
    NotificationEventService,
    DeviceTokenService,
    NotificationPushProcessor,
    // Notify 策略（与 order.module 同款注册；PUSH 批A A2 切 Expo，dev 无凭证 stub 降级）
    EmailNotifyStrategy,
    SmsNotifyStrategy,
    PushNotifyStrategy,
    WhatsAppNotifyStrategy,
    NotifyFactory,
    // 显式声明 DI token，避免 tsx esbuild 不生成 emitDecoratorMetadata 导致 Inject token 无法解析
    { provide: 'NotifyFactoryToken', useExisting: NotifyFactory },
    // 事件挂点 token 必须在本模块 providers 注册（审查 P1-1：仅写 exports 不注册会
    // 抛 UnknownExportException，Nest 11 validateExportedProvider 启动即崩）
    { provide: 'NotificationEventServiceToken', useExisting: NotificationEventService },
    // 批A A5：BullMQ 队列注入 token（审查 P1-2：getQueueToken 必须带队列名，
    // 无参解析到 BullQueue_default——本仓无 default 队列注册，会二次启动失败）
    { provide: 'NotificationQueueToken', useExisting: getQueueToken(NOTIFICATION_QUEUE) },
  ],
  exports: [
    // 事件挂点：order/dispatch/settle 模块注入（批A A4，显式 token 防 tsx 装饰器元数据缺失）
    // token 已在上方 providers 注册（P1-1）
    { provide: 'NotificationEventServiceToken', useExisting: NotificationEventService },
    NotificationEventService,
    NotificationService,
    DeviceTokenService,
  ],
})
export class NotificationModule {}
