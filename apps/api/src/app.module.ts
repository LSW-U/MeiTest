import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { TraceIdInterceptor } from './shared/interceptors/trace-id.interceptor';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [],
  controllers: [HealthController],
  providers: [
    // 全局拦截器（顺序：TraceId 先（让 logger 拿到 traceId）→ Logging）
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
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
