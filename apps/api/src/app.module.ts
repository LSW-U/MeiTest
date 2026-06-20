import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost, Reflector } from '@nestjs/core';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { TraceIdInterceptor } from './shared/interceptors/trace-id.interceptor';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { AuditInterceptor } from './shared/interceptors/audit.interceptor';
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
    // Guards 依赖的 Reflector 已由 NestJS core 提供
    // Guards 实例显式注册（avoid tsx esbuild 不生成 emitDecoratorMetadata 导致 DI 失败）
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    DeviceTypeGuard,
    // 全局拦截器（顺序：TraceId 先 → Logging → Audit）
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
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
export class AppModule {}
