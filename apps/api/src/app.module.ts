import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD, HttpAdapterHost, Reflector } from '@nestjs/core';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { AuditInterceptor } from './shared/interceptors/audit.interceptor';
import { TraceIdMiddleware } from './shared/middleware/trace-id.middleware';
import { HealthController } from './modules/health/health.controller';
import { MeController } from './modules/me/me.controller';
import { AuthModule } from './modules/auth/auth.module';
// 三流程 merge：按字母序排列 imports（避免再次冲突）
// FLOW W（供给/仓储/浏览）: Catalog / Inventory / Pricing / Shop / User / Warehouse
// FLOW C（交易/配送）: Cart / Dispatch / Order / Payment / Rider
// FLOW M（治理/财务）: Platform / Settle
// Shared: Idempotency / Queue
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { ImModule } from './modules/im/im.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RefundModule } from './modules/refund/refund.module';
import { RiderModule } from './modules/rider/rider.module';
import { SettleModule } from './modules/settle/settle.module';
import { ShopModule } from './modules/shop/shop.module';
import { UserModule } from './modules/user/user.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { IdempotencyModule } from './shared/idempotency/idempotency.module';
import { QueueModule } from './shared/queue';
import { JwtStrategy } from './modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { RolesGuard } from './shared/guards/roles.guard';
import { DeviceTypeGuard } from './shared/guards/device-type.guard';

@Module({
  // 字母序合并（W + C + M 三流程）：Auth → Cart → Catalog → Dispatch → Im → Inventory →
  //   Order → Payment → Platform → Pricing → Realtime → Rider → Settle → Shop →
  //   User → Warehouse + Idempotency + Queue
  imports: [
    AuthModule,
    CartModule,
    CatalogModule,
    DispatchModule,
    ImModule,
    InventoryModule,
    OrderModule,
    PaymentModule,
    PlatformModule,
    PricingModule,
    RealtimeModule,
    RefundModule,
    RiderModule,
    SettleModule,
    ShopModule,
    UserModule,
    WarehouseModule,
    IdempotencyModule,
    QueueModule,
  ],
  controllers: [HealthController, MeController],
  providers: [
    // Guards 实例显式注册（avoid tsx esbuild 不生成 emitDecoratorMetadata 导致 DI 失败）
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    DeviceTypeGuard,
    // P0-2：APP_GUARD 全局注册三道闸门（顺序：Jwt → DeviceType → Roles）
    //   - JwtAuthGuard：默认所有端点需要登录，公开端点显式 @Public()
    //   - DeviceTypeGuard：拒跨端调用（client/rider/admin 前缀对应 deviceType）
    //   - RolesGuard：least privilege，未声明 @Roles() 默认拒（防业务 controller 忘加）
    // 避免每个 controller 手动 @UseGuards，新增 controller 一忘加就裸奔
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: DeviceTypeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // 全局拦截器（顺序：Logging → Audit）
    // TraceId 改用 Middleware（在 Guard 之前），Interceptor 仅保留兼容
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new LoggingInterceptor(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new AuditInterceptor(reflector),
      inject: [Reflector],
    },
    // 全局过滤器（DI 注入 HttpAdapterHost）
    {
      provide: APP_FILTER,
      useFactory: (httpAdapterHost: HttpAdapterHost) =>
        new AllExceptionsFilter(httpAdapterHost),
      inject: [HttpAdapterHost],
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * TraceIdMiddleware 在所有路由之前注入 ALS traceId
   * 确保 Guard 抛错时 AllExceptionsFilter 也能拿到 traceId
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}
