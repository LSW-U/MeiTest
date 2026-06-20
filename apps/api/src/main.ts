/**
 * MeiMart API bootstrap
 *
 * 决策依据：D4-T1 acceptance
 *   - 所有请求带 X-Trace-Id header ✅ TraceIdInterceptor
 *   - 异常返回统一结构 { code, message, traceId, i18nKey } ✅ AllExceptionsFilter
 *   - pino 结构化日志 ✅ logger.ts
 *   - Swagger UI 入口 /docs（闭环 D1-T6）✅ swagger-ui-express serve openapi.yaml
 *
 * 启动：pnpm --filter @meimart/api dev
 */
import 'reflect-metadata';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { logger } from './shared/logger/logger';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import swaggerUi from 'swagger-ui-express';
import yaml from 'yaml';
import fs from 'node:fs';
import path from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // CORS（dev/staging 不同 origin）
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', 'X-Perspective', 'Accept-Language', 'X-Request-Id'],
  });

  // 全局 ValidationPipe（class-validator，zod 在 controller 显式注入）
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 全局过滤器（DI 注入 HttpAdapterHost）
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost));

  // Swagger UI /docs（serve api-contract/openapi.yaml，闭环 D1-T6）
  const openapiPath = path.resolve(__dirname, '..', '..', '..', 'packages', 'api-contract', 'openapi.yaml');
  try {
    if (fs.existsSync(openapiPath)) {
      const openapi = yaml.parse(fs.readFileSync(openapiPath, 'utf-8'));
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'MeiMart API' }));
      logger.info({ msg: 'swagger_ui_ready', path: '/docs', openapiPath });
    } else {
      logger.warn({ msg: 'openapi_yaml_missing', openapiPath });
    }
  } catch (e) {
    logger.error({ msg: 'swagger_ui_setup_failed', error: (e as Error).message });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  logger.info({ msg: 'meimart_api_started', port, env: process.env.NODE_ENV ?? 'development' });

  // 全局 logger（NestJS 内部用）
  app.useLogger(new Logger());
}

void bootstrap();
