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
import { assertAllJwtSecrets } from './shared/auth/assert-jwt-secret';
import swaggerUi from 'swagger-ui-express';
import yaml from 'yaml';
import fs from 'node:fs';
import path from 'node:path';

// Sentry 最先初始化（在 NestFactory.create 之前，确保启动错误也被捕获）
initSentry();

// P0-1：JWT secret 校验紧随 Sentry 之后（漏配时 fail-fast，bootstrap 直接挂）
assertAllJwtSecrets();

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

  // 审查报告 P1 #6：生产部署在 nginx TLS-terminating 反代后，req.protocol 默认是 http
  // 导致 im-signature.resolveWsUrl 推断出 ws://（mixed-content 拒绝）
  // 信任一级反代（X-Forwarded-Proto），req.protocol 正确反映客户端协议
  const expressInstance = app.getHttpAdapter().getInstance();
  if (typeof expressInstance.set === 'function') {
    expressInstance.set('trust proxy', 1);
  }

  // 审查报告 P1 #6：prod 强制 WS_URL 配置（避免反代场景推断出错）
  if (process.env.NODE_ENV === 'production' && !process.env.WS_URL?.trim()) {
    throw new Error(
      'WS_URL must be set in production (e.g. wss://api.meimart.com) — TLS-terminating reverse proxies cannot infer ws/wss scheme from req.protocol without explicit config',
    );
  }

  // 替换 NestJS 默认 logger 为 pino（在 listen 前注入，启动日志也走 pino）
  app.useLogger(nestLogger);

  // CORS（dev/staging/prod 不同 origin 白名单）
  // P0-3：prod 强制 CORS_ORIGIN 非空（避免漏配导致 origin=true 反射任意域名 + credentials=true 引发 CSRF）
  //       dev 默认 true 方便本地多端口联调（admin-web 3001 / client-app 8081 等）
  const corsOriginEnv = process.env.CORS_ORIGIN;
  if (!corsOriginEnv && process.env.NODE_ENV === 'production') {
    throw new Error(
      'CORS_ORIGIN must be set in production (comma-separated allowlist, e.g. https://admin.meimart.com,https://www.meimart.com)',
    );
  }
  app.enableCors({
    origin: corsOriginEnv ? corsOriginEnv.split(',').map((s) => s.trim()) : true,
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
