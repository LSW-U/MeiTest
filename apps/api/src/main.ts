/**
 * MeiMart API bootstrap
 *
 * 决策依据：D4-T1 acceptance
 *   - 所有请求带 X-Trace-Id header ✅ TraceIdInterceptor
 *   - 异常返回统一结构 { code, message, traceId, i18nKey } ✅ AllExceptionsFilter（AppModule APP_FILTER）
 *   - pino 结构化日志 ✅ logger.ts（useLogger 注入在 listen 之前）
 *   - Swagger UI 入口 /docs（闭环 D1-T6）✅ swagger-ui-express serve openapi.yaml
 *
 * 启动：pnpm --filter @meimart/api dev
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, LoggerService } from '@nestjs/common';
import { AppModule } from './app.module';
import { logger as pinoLogger } from './shared/logger/logger';
import { initSentry } from './shared/monitoring/sentry';
import swaggerUi from 'swagger-ui-express';
import yaml from 'yaml';
import fs from 'node:fs';
import path from 'node:path';

// Sentry 最先初始化（在 NestFactory.create 之前，确保启动错误也被捕获）
initSentry();

/** pino wrapper（适配 NestJS LoggerService 接口） */
const nestLogger: LoggerService = {
  log: (msg: unknown) => pinoLogger.info({ msg }),
  error: (msg: unknown) => pinoLogger.error({ msg }),
  warn: (msg: unknown) => pinoLogger.warn({ msg }),
  debug: (msg: unknown) => pinoLogger.debug({ msg }),
  verbose: (msg: unknown) => pinoLogger.trace({ msg }),
  fatal: (msg: unknown) => pinoLogger.fatal({ msg }),
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // 替换 NestJS 默认 logger 为 pino（在 listen 前注入，启动日志也走 pino）
  app.useLogger(nestLogger);

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

  // 全局过滤器、拦截器由 AppModule 通过 APP_FILTER / APP_INTERCEPTOR 注册（避免重复）

  // Swagger UI /docs（serve api-contract/openapi.yaml，闭环 D1-T6）
  const openapiPath = path.resolve(__dirname, '..', '..', '..', 'packages', 'api-contract', 'openapi.yaml');
  try {
    if (fs.existsSync(openapiPath)) {
      const openapi = yaml.parse(fs.readFileSync(openapiPath, 'utf-8'));
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'MeiMart API' }));
      pinoLogger.info({ msg: 'swagger_ui_ready', path: '/docs', openapiPath });
    } else {
      pinoLogger.warn({ msg: 'openapi_yaml_missing', openapiPath });
    }
  } catch (e) {
    pinoLogger.error({ msg: 'swagger_ui_setup_failed', error: (e as Error).message });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  pinoLogger.info({ msg: 'meimart_api_started', port, env: process.env.NODE_ENV ?? 'development' });
}

void bootstrap();
