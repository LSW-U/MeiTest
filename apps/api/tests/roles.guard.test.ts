import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../src/shared/guards/roles.guard';
import type { Reflector } from '@nestjs/core';

function createMockContext(
  metadata: Record<string, unknown>,
  user: { sub: string; role: string; deviceType: string } | undefined,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as ExecutionContext;
}

function createMockReflector(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('@Public() 端点直接通过', () => {
    const reflector = createMockReflector({ isPublic: true });
    const guard = new RolesGuard(reflector);
    const ctx = createMockContext({}, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('无 @Roles() 声明 → 默认拒绝（E-AUTH-008）', () => {
    const reflector = createMockReflector({ isPublic: false, roles: undefined });
    const guard = new RolesGuard(reflector);
    const ctx = createMockContext({}, { sub: 'u1', role: 'CUSTOMER', deviceType: 'client_app' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    try {
      guard.canActivate(ctx);
    } catch (e) {
      const exc = e as ForbiddenException;
      const resp = exc.getResponse() as { code: string };
      expect(resp.code).toBe('E-AUTH-008');
    }
  });

  it('角色匹配 → 通过', () => {
    const reflector = createMockReflector({
      isPublic: false,
      roles: ['SUPER_ADMIN', 'WAREHOUSE_STAFF'],
    });
    const guard = new RolesGuard(reflector);
    const ctx = createMockContext({}, { sub: 'u1', role: 'SUPER_ADMIN', deviceType: 'admin_web' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('角色不匹配 → 拒绝（E-AUTH-010）', () => {
    const reflector = createMockReflector({ isPublic: false, roles: ['SUPER_ADMIN'] });
    const guard = new RolesGuard(reflector);
    const ctx = createMockContext({}, { sub: 'u1', role: 'CUSTOMER', deviceType: 'client_app' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    try {
      guard.canActivate(ctx);
    } catch (e) {
      const exc = e as ForbiddenException;
      const resp = exc.getResponse() as { code: string };
      expect(resp.code).toBe('E-AUTH-010');
    }
  });

  it('无 user → 401（E-AUTH-002，防御性死代码）', () => {
    const reflector = createMockReflector({ isPublic: false, roles: ['CUSTOMER'] });
    const guard = new RolesGuard(reflector);
    const ctx = createMockContext({}, undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    try {
      guard.canActivate(ctx);
    } catch (e) {
      const exc = e as UnauthorizedException;
      const resp = exc.getResponse() as { code: string };
      expect(resp.code).toBe('E-AUTH-002');
    }
  });
});
