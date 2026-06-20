/**
 * 审计拦截器（视角切换核心）
 *
 * 决策依据：W1-D4-T5 + CLAUDE.md §视角切换
 *   - 所有写操作（POST/PUT/PATCH/DELETE）自动写 AuditLog
 *   - 字段：userId / action / resource / resourceId / before / after / perspective / deviceType / ip / userAgent / traceId
 *   - perspective 从 X-Perspective header 读取（前端 zustand 持久化 + fetch interceptor 注入）
 *   - deviceType 从 JWT payload 读取（request.user.deviceType）
 *   - 敏感字段自动 mask（password / token / secret 等）
 *
 * 后端 RBAC 不感知 perspective（只看 role），perspective 仅用于审计
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { Prisma } from '../../prisma/client';
import { db } from '../../shared/db';
import { AUDIT_KEY, DEFAULT_MASK_FIELDS, type AuditOptions } from '../decorators/audit.decorator';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** JWT 小写 deviceType → Prisma enum 大写 */
function toPrismaDeviceType(d: RequestUser['deviceType'] | undefined): 'CLIENT_APP' | 'RIDER_APP' | 'ADMIN_WEB' | null {
  if (!d) return null;
  if (d === 'client_app') return 'CLIENT_APP';
  if (d === 'rider_app') return 'RIDER_APP';
  return 'ADMIN_WEB';
}

function maskSensitiveFields(obj: unknown, maskFields: string[]): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => maskSensitiveFields(v, maskFields));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lowerK = k.toLowerCase();
    if (maskFields.some((f) => lowerK.includes(f))) {
      result[k] = '[REDACTED]';
    } else if (v !== null && typeof v === 'object') {
      result[k] = maskSensitiveFields(v, maskFields);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function getResourceName(controllerName: string | undefined, options: AuditOptions | undefined): string {
  if (options?.resource) return options.resource;
  if (!controllerName) return 'Unknown';
  // OrderController → Order
  return controllerName.replace(/Controller$/, '');
}

function getResourceId(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  // 常见命名：id / orderId / productId / skuId
  for (const key of ['id', 'orderId', 'productId', 'skuId', 'userId', 'warehouseId']) {
    if (typeof params[key] === 'string') return params[key] as string;
  }
  return undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const method: string = (request.method ?? '').toUpperCase();

    // 只审计写操作（GET 跳过）
    if (!WRITE_METHODS.has(method)) {
      return next.handle();
    }

    // 检查 @Audit() 装饰器
    const auditOptions = this.reflector.getAllAndOverride<AuditOptions | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (auditOptions?.skip) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // 异步写 AuditLog（不阻塞响应）
          this.writeAuditLog(context, method, response.statusCode, responseData, startTime, auditOptions).catch(
            (e) => {
              this.logger.warn({
                msg: 'audit_log_write_failed',
                error: (e as Error).message,
                url: request.url,
              });
            },
          );
        },
        // 错误响应由 AllExceptionsFilter 处理；审计只记录成功响应
        // 失败响应的审计由专门的 ErrorAudit 拦截器或 controller 显式处理（MVP 不做）
      }),
    );
  }

  private async writeAuditLog(
    context: ExecutionContext,
    method: string,
    statusCode: number,
    responseData: unknown,
    startTime: number,
    options: AuditOptions | undefined,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    const handler = context.getHandler();
    const controller = context.getClass();

    const maskFields = [...DEFAULT_MASK_FIELDS, ...(options?.maskFields ?? [])];
    const resource = getResourceName(controller?.name, options);
    const resourceId = getResourceId(request.params);
    const perspective = request.headers['x-perspective'] as string | undefined;
    const userAgent = request.headers['user-agent'] as string | undefined;
    const ip = (request.headers['x-forwarded-for'] as string | undefined) ?? request.ip;
    const traceId = request.traceId as string | undefined;

    // 构造 action：CREATE/UPDATE/DELETE + resource
    let action: string;
    if (method === 'POST') action = 'CREATE';
    else if (method === 'DELETE') action = 'DELETE';
    else action = 'UPDATE';

    await db.auditLog.create({
      data: {
        userId: user?.sub ?? null,
        action: `${action}_${resource.toUpperCase()}`,
        resourceType: resource,
        resourceId: resourceId ?? null,
        // before/after MVP 不实现（需要 controller 显式提供，或 raw SQL 触发器）
        beforeData: Prisma.JsonNull,
        afterData:
          statusCode < 400
            ? (maskSensitiveFields(responseData, maskFields) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        deviceType: toPrismaDeviceType(user?.deviceType),
        perspective: perspective ?? null,
        ip: typeof ip === 'string' ? ip.slice(0, 50) : null,
        userAgent: userAgent ? userAgent.slice(0, 500) : null,
        traceId: traceId ?? null,
      },
    });

    void handler;
    void startTime;
  }
}
