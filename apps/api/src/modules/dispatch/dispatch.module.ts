/**
 * Dispatch Module — 注册 DispatchService + Controller
 *
 * 依赖：
 *   - RealtimeModule（提供 RealtimeGateway，WS 广播用）
 *
 * 被 OrderService 调用：
 *   - 订单 CONFIRMED 时调 createTaskForOrder（注入 DISPATCH_SERVICE_TOKEN 避免循环）
 */
import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { RealtimeModule } from '../realtime/realtime.module';

/** DispatchService DI token（OrderService 用此 token 注入避免循环依赖） */
export const DISPATCH_SERVICE_TOKEN = Symbol('DISPATCH_SERVICE_TOKEN');

@Module({
  imports: [RealtimeModule],
  controllers: [DispatchController],
  providers: [
    DispatchService,
    { provide: DISPATCH_SERVICE_TOKEN, useExisting: DispatchService },
  ],
  exports: [DispatchService, DISPATCH_SERVICE_TOKEN],
})
export class DispatchModule {}
