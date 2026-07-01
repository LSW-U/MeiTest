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
 */
import { Module, forwardRef } from '@nestjs/common';
import { RefundService } from './refund.service';
import { ClientRefundController, AdminRefundController } from './refund.controller';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [forwardRef(() => OrderModule)],
  controllers: [ClientRefundController, AdminRefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
