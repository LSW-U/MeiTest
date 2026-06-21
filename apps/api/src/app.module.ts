import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost, Reflector } from '@nestjs/core';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { AuditInterceptor } from './shared/interceptors/audit.interceptor';
import { TraceIdMiddleware } from './shared/middleware/trace-id.middleware';
import { HealthController } from './modules/health/health.controller';
import { MeController } from './modules/me/me.controller';
import { AuthModule } from './modules/auth/auth.module';
import { JwtStrategy } from './modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { RolesGuard } from './shared/guards/roles.guard';
import { DeviceTypeGuard } from './shared/guards/device-type.guard';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, MeController],
  providers: [
    // Guards 实例显式注册（avoid tsx esbuild 不生成 emitDecoratorMetadata 导致 DI 失败）
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    DeviceTypeGuard,
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
