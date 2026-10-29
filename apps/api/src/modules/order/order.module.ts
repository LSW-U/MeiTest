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
import { NotificationModule } from '../notification/notification.module';
import { NotificationEventService } from '../notification/notification-event.service';
import { RefundModule } from '../refund/refund.module';
import { PromotionModule } from '../promotion/promotion.module';
import { PricingModule } from '../pricing/pricing.module';
import { NotifyFactory, EmailNotifyStrategy, SmsNotifyStrategy, PushNotifyStrategy, WhatsAppNotifyStrategy } from '../../infrastructure';
import { OutOfStockService } from './out-of-stock.service';
import { OutOfStockRefundService } from './out-of-stock-refund.service';
import { RiderOutOfStockController } from './rider-out-of-stock.controller';
// 替换品批1（2026-10-29 D7）：PENDING 建议超时扫描（scheduler 注册 + processor 消费）
import { SuggestionTimeoutScheduler } from './suggestion-timeout.scheduler';
import { SuggestionTimeoutProcessor } from './suggestion-timeout.processor';
import { SUGGESTION_TIMEOUT_QUEUE } from '../../shared/queue';
// 批1：evidenceUrls 前缀校验需 StorageService（isOwnUrl 语义，同 dispatch.module 先例）
import { StorageModule } from '../../shared/storage/storage.module';

@Module({
  imports: [
    forwardRef(() => PaymentModule),
    forwardRef(() => DispatchModule),
    forwardRef(() => CartModule),
    forwardRef(() => RefundModule),
    // 批A（2026-09-09）：NotificationEventService（七类事件挂点，站内信+PUSH）
    forwardRef(() => NotificationModule),
    PromotionModule,
    PricingModule,
    RealtimeModule,
    StorageModule,
    BullModule.registerQueue({ name: ORDER_TIMEOUT_QUEUE }),
    // 替换品批1（D7）：PENDING 建议超时扫描队列
    BullModule.registerQueue({ name: SUGGESTION_TIMEOUT_QUEUE }),
  ],
  controllers: [OrderController, AdminOrderController, RiderOutOfStockController],
  providers: [
    OrderService,
    OrderNoService,
    OrderTimeoutProcessor,
    // 缺货履约闭环批1（2026-10-24）：缺货登记服务（admin 拣货段 + 骑手 DELIVERING 兜底）
    OutOfStockService,
    // 批3（D9b 2026-10-24）：system 自动退款引擎（登记链 commit 后触发，规则表为源）
    OutOfStockRefundService,
    // 替换品批1（D7 2026-10-29）：PENDING 建议超时扫描
    SuggestionTimeoutScheduler,
    SuggestionTimeoutProcessor,
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
    { provide: 'NotificationEventServiceToken', useExisting: NotificationEventService },
    // 替换品批1（D7）：processor 取 OrderService（退款链 + 推送）的显式 token
    { provide: 'SUGGESTION_TIMEOUT_ORDER_SERVICE', useExisting: OrderService },
  ],
  exports: [OrderService, OrderNoService],
})
export class OrderModule {}
