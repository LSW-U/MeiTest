/**
 * Refund Module — 退款模块（W5 流程 C）
 *
 * 注册：
 *   - RefundService
 *   - ClientRefundController（/api/v1/client/refunds）
 *   - AdminRefundController（/api/v1/admin/refunds）
 */
import { Module } from '@nestjs/common';
import { RefundService } from './refund.service';
import { ClientRefundController, AdminRefundController } from './refund.controller';

@Module({
  controllers: [ClientRefundController, AdminRefundController],
  providers: [RefundService],
  exports: [RefundService],
})
export class RefundModule {}
