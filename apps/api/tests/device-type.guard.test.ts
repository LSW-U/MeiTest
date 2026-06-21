import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { DeviceTypeGuard } from '../src/shared/guards/device-type.guard';

function createMockContext(
  url: string,
  method: string,
  user: { sub: string; role: string; deviceType: string } | undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url, method, user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as ExecutionContext;
}

describe('DeviceTypeGuard', () => {
  const guard = new DeviceTypeGuard();

  it('/api/v1/client/* + client_app token → 通过', () => {
    const ctx = createMockContext('/api/v1/client/orders', 'GET', {
      sub: 'u1',
      role: 'customer',
      deviceType: 'client_app',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('/api/v1/client/* + rider_app token → 拒绝 E-AUTH-001', () => {
    const ctx = createMockContext('/api/v1/client/orders', 'GET', {
      sub: 'u1',
      role: 'rider',
      deviceType: 'rider_app',
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    try {
      guard.canActivate(ctx);
    } catch (e) {
      const resp = (e as ForbiddenException).getResponse() as { code: string };
      expect(resp.code).toBe('E-AUTH-001');
    }
  });

  it('/api/v1/admin/* + admin_web token → 通过', () => {
    const ctx = createMockContext('/api/v1/admin/me', 'GET', {
      sub: 'u1',
      role: 'super_admin',
      deviceType: 'admin_web',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('/api/v1/admin/* + client_app token → 拒绝', () => {
    const ctx = createMockContext('/api/v1/admin/me', 'GET', {
      sub: 'u1',
      role: 'customer',
      deviceType: 'client_app',
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('/api/v1/common/* 不限制 → 通过（任何 deviceType）', () => {
    const ctx = createMockContext('/api/v1/common/auth/login', 'POST', {
      sub: 'u1',
      role: 'customer',
      deviceType: 'client_app',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('/api/v1/clientXYZ 不匹配 /api/v1/client（精确边界）', () => {
    const ctx = createMockContext('/api/v1/clientXYZ', 'GET', {
      sub: 'u1',
      role: 'customer',
      deviceType: 'client_app',
    });
    // /api/v1/clientXYZ 不匹配任何 ROUTE_DEVICE_MAP 规则，视为 common（不限制）
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('/health 不限制 → 通过', () => {
    const ctx = createMockContext('/health', 'GET', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('无 user（未登录）→ 通过（JwtAuthGuard 处理认证）', () => {
    const ctx = createMockContext('/api/v1/client/orders', 'GET', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
