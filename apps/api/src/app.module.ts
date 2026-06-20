import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { TraceIdInterceptor } from './shared/interceptors/trace-id.interceptor';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { AuditInterceptor } from './shared/interceptors/audit.interceptor';
import { HealthController } from './modules/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [
    // 全局拦截器（顺序：TraceId 先 → Logging → Audit）
    // TraceId 注入 traceId 给后续 logger 用
    // Logging 记录请求耗时
    // Audit 异步写 AuditLog（写操作）
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
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
