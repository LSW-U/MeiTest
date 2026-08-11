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
 */
import { Module, forwardRef } from '@nestjs/common';
import { RefundService } from './refund.service';
import { ClientRefundController, AdminRefundController } from './refund.controller';
import { OrderModule } from '../order/order.module';
import { StorageModule } from '../../shared/storage/storage.module';
// P14 ④：refund APPROVE + RETURN_REFUND 触发建 return task（DispatchService via ModuleRef）
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  imports: [forwardRef(() => OrderModule), StorageModule, DispatchModule],
  controllers: [ClientRefundController, AdminRefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
