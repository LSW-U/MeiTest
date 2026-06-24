/**
 * Order Module — 注册 OrderService + OrderNoService + Controller
 *
 * 依赖：
 *   - PaymentModule（提供 PAYMENT_SERVICE_TOKEN）
 *
 * 不直接 import infrastructure（用 withTransaction + deductStock + findWarehouseByPoint 这些 shared/db 纯函数）
 */
import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderNoService } from './order-no.service';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [PaymentModule],
  controllers: [OrderController],
  providers: [OrderService, OrderNoService],
  exports: [OrderService, OrderNoService],
})
export class OrderModule {}
