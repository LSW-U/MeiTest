/**
 * DeviceType Guard（拒跨端调用）
 *
 * 决策依据：W1-D4-T4 + CLAUDE.md §视角切换
 *   - /api/v1/client/* 必须 deviceType=client_app（客户端 App token）
 *   - /api/v1/rider/* 必须 deviceType=rider_app（骑手 App token）
 *   - /api/v1/admin/* 必须 deviceType=admin_web（后台 Web token）
 *   - /api/v1/common/* 不限制（登录 / 公共配置等，无 JWT 时跳过）
 *
 * 防御场景：客户端 App token 被泄露后无法调后台 API 提权
 *
 * 用法：
 *   @UseGuards(JwtAuthGuard, DeviceTypeGuard, RolesGuard)
 *   @Controller('client/orders')
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { DeviceType } from '@meimart/api-contract';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';

/** URL 前缀 → required deviceType 映射（不含 common，common 不限制） */
const ROUTE_DEVICE_MAP: Array<{ prefix: string; deviceType: DeviceType }> = [
  { prefix: '/api/v1/client', deviceType: 'client_app' },
  { prefix: '/api/v1/rider', deviceType: 'rider_app' },
  { prefix: '/api/v1/admin', deviceType: 'admin_web' },
  // 后台管理 W2+ 可能用 /api/v1/admin/platform 等，前缀匹配自动覆盖
];

@Injectable()
export class DeviceTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const url: string = request.url ?? '';
    const method: string = request.method ?? '';

    // 只检查写操作 + 鉴权后的请求（GET / 公共资源不限制）
    // 实际生产可按需调整，MVP 默认全请求检查（避免漏检）
    // 精确边界匹配：避免 /api/v1/clientXYZ 误匹配 /api/v1/client
    const matchedRule = ROUTE_DEVICE_MAP.find(
      (r) => url === r.prefix || url.startsWith(r.prefix + '/') || url.startsWith(r.prefix + '?'),
    );
    if (!matchedRule) {
      // common / health / docs 等不限制
      return true;
    }

    const user = request.user as RequestUser | undefined;

    // 未登录（如 common/auth/login）跳过此 guard（JwtAuthGuard 已处理）
    if (!user) {
      return true;
    }

    if (user.deviceType !== matchedRule.deviceType) {
      throw new ForbiddenException({
        code: 'E-AUTH-001',
        message: `Endpoint requires deviceType='${matchedRule.deviceType}', but token has '${user.deviceType}'`,
        details: {
          urlPrefix: matchedRule.prefix,
          required: matchedRule.deviceType,
          current: user.deviceType,
          method,
        },
      });
    }

    return true;
  }
}
