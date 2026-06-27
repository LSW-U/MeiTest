/**
 * Order Module — 注册 OrderService + OrderNoService + OrderTimeoutProcessor + Controller
 *
 * 依赖：
 *   - PaymentModule（提供 PAYMENT_SERVICE_TOKEN）
 *   - DispatchModule（提供 DISPATCH_SERVICE_TOKEN，CONFIRMED 时自动建配送任务）
 *   - CartModule（提供 CART_SERVICE_TOKEN，下单后清空购物车）
 *   - RealtimeModule（W4-REVIEW P0-3：broadcastOrderStatusChange 串接）
 *   - NotifyFactory（W4-REVIEW P0-3：订单确认邮件 + SMS 通知）
 *   - BullModule.registerQueue（提供 ORDER_TIMEOUT_QUEUE injection token）
 */
import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderController } from './order.controller';
import { AdminOrderController } from './admin-order.controller';
import { OrderService } from './order.service';
import { OrderNoService } from './order-no.service';
import { OrderTimeoutProcessor } from './order-timeout.processor';
import { ORDER_TIMEOUT_QUEUE } from '../../shared/queue';
import { PaymentModule } from '../payment/payment.module';
import { DispatchModule, DISPATCH_SERVICE_TOKEN } from '../dispatch/dispatch.module';
import { CartModule, CART_SERVICE_TOKEN } from '../cart/cart.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotifyFactory, EmailNotifyStrategy, SmsNotifyStrategy, PushNotifyStrategy, WhatsAppNotifyStrategy } from '../../infrastructure';

@Module({
  imports: [
    forwardRef(() => PaymentModule),
    forwardRef(() => DispatchModule),
    forwardRef(() => CartModule),
    RealtimeModule,
    BullModule.registerQueue({ name: ORDER_TIMEOUT_QUEUE }),
  ],
  controllers: [OrderController, AdminOrderController],
  providers: [
    OrderService,
    OrderNoService,
    OrderTimeoutProcessor,
    // Notify 策略（W4-REVIEW P0-3）
    EmailNotifyStrategy,
    SmsNotifyStrategy,
    PushNotifyStrategy,
    WhatsAppNotifyStrategy,
    NotifyFactory,
    // 显式声明 DI token，避免 tsx esbuild 不生成 emitDecoratorMetadata 导致 Inject token 无法解析
    { provide: 'DISPATCH_SERVICE_TOKEN', useExisting: DISPATCH_SERVICE_TOKEN },
    { provide: 'CART_SERVICE_TOKEN', useExisting: CART_SERVICE_TOKEN },
    { provide: 'RealtimeGatewayToken', useExisting: RealtimeGateway },
    { provide: 'NotifyFactoryToken', useExisting: NotifyFactory },
  ],
  exports: [OrderService, OrderNoService],
})
export class OrderModule {}
