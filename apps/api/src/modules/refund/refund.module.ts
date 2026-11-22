/**
 * Refund Module — 退款模块（W5 流程 C）
 *
 * 注册：
 *   - RefundService
 *   - ClientRefundController（/api/v1/client/refunds）
 *   - AdminRefundController（/api/v1/admin/refunds）
 *
 * 依赖：
 *   - OrderModule（forwardRef 解决循环依赖，用于接单前退款自动取消订单）
 *   - StorageModule（P13 审查 P1 修复：photos URL host 白名单校验，防 SSRF/追踪/钓鱼）
 *   - NotificationModule（forwardRef，批1 审查 P1-1 修复 20261122：cancelOrderInTx 的
 *     orderCancelled 通知挂点 D13 需要 NotificationEventService——此前 imports 缺本模块，
 *     生产 DI 下 @Optional 静默 undefined，通知恒不发；非 Global 且 OrderModule exports
 *     不透传，必须本模块显式 import）
 */
import { Module, forwardRef } from '@nestjs/common';
import { RefundService } from './refund.service';
import { ClientRefundController, AdminRefundController } from './refund.controller';
import { OrderModule } from '../order/order.module';
import { StorageModule } from '../../shared/storage/storage.module';
// P14 ④：refund APPROVE + RETURN_REFUND 触发建 return task（DispatchService via ModuleRef）
import { DispatchModule } from '../dispatch/dispatch.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    forwardRef(() => OrderModule),
    StorageModule,
    DispatchModule,
    // 批1 审查 P1-1 修复（20261122）：D13 通知门面注入来源
    forwardRef(() => NotificationModule),
  ],
  controllers: [ClientRefundController, AdminRefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
