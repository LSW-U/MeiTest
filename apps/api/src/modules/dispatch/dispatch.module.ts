/**
 * Dispatch Module — 注册 DispatchService + Controller
 *
 * 依赖：
 *   - RealtimeModule（提供 RealtimeGateway，WS 广播用）
 *   - RiderModule（批 D 2026-09-03：提供 DepositEligibilityService，acceptTask/大厅/派单候选
 *     三处保证金资格拦截——方案 Q9「后端双处强制」的第三处 admin 候选同在此模块）
 *
 * 被 OrderService 调用：
 *   - 订单 CONFIRMED 时调 createTaskForOrder（注入 DISPATCH_SERVICE_TOKEN 避免循环）
 */
import { Module, forwardRef } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { AdminDispatchController } from './admin-dispatch.controller';
import { DispatchService } from './dispatch.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { RiderModule } from '../rider/rider.module';
import { NotificationModule } from '../notification/notification.module';
import { NotificationEventService } from '../notification/notification-event.service';

/** DispatchService DI token（OrderService 用此 token 注入避免循环依赖） */
export const DISPATCH_SERVICE_TOKEN = Symbol('DISPATCH_SERVICE_TOKEN');

@Module({
  imports: [RealtimeModule, RiderModule, forwardRef(() => NotificationModule)],
  controllers: [DispatchController, AdminDispatchController],
  providers: [
    DispatchService,
    { provide: DISPATCH_SERVICE_TOKEN, useExisting: DispatchService },
    // 批A A4：事件通知挂点（显式 token 防 tsx 装饰器元数据缺失；useExisting 指向类，避免自引用）
    { provide: 'NotificationEventServiceToken', useExisting: NotificationEventService },
  ],
  exports: [DispatchService, DISPATCH_SERVICE_TOKEN],
})
export class DispatchModule {}
