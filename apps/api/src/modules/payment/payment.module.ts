/**
 * Payment Module — 业务层（包裹 infrastructure/payment 策略）
 *
 * 注册：
 *   - PaymentService（用 PAYMENT_SERVICE_TOKEN 注入，解循环依赖）
 *   - PaymentController（路由 /api/v1/client/payments）
 *
 * 不导出 PaymentService 给其他模块（用 token 注入）。
 * OrderModule import PaymentModule 后通过 token 拿 service。
 */
import { Module, forwardRef } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService, PAYMENT_SERVICE_TOKEN } from './payment.service';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [forwardRef(() => OrderModule)],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    { provide: PAYMENT_SERVICE_TOKEN, useExisting: PaymentService },
  ],
  exports: [PaymentService, PAYMENT_SERVICE_TOKEN],
})
export class PaymentModule {}
