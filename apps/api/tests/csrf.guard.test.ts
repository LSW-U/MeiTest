/**
 * CSRF Guard 单测（F3：从 middleware 迁移为 Guard，2026-07-23）
 *
 * 核心断言：
 *   1. 无 admin cookie（移动端 Bearer / 登录前）→ 放行（移动端无 CSRF 风险）
 *   2. GET / HEAD / OPTIONS → 放行（安全方法）
 *   3. mutate + admin cookie + header 缺失/不匹配 → 403 E-AUTH-011
 *   4. mutate + header === cookie → 放行
 */
import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from '../src/shared/guards/csrf.guard';

interface MakeCtxOpts {
  method?: string;
  adminCookie?: string;
  csrfCookie?: string;
  csrfHeader?: string;
}

/** 造一个 mock ExecutionContext（只含 switchToHttp.getRequest） */
function makeContext(opts: MakeCtxOpts) {
  const cookies: Record<string, string> = {};
  if (opts.adminCookie !== undefined) cookies.admin_access_token = opts.adminCookie;
  if (opts.csrfCookie !== undefined) cookies.admin_csrf = opts.csrfCookie;
  const headers: Record<string, string> = {};
  if (opts.csrfHeader !== undefined) headers['x-csrf-token'] = opts.csrfHeader;
  const req = { method: opts.method ?? 'GET', cookies, headers };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  describe('放行场景', () => {
    it('无 admin cookie（移动端 Bearer / 登录前请求）→ 放行', () => {
      expect(guard.canActivate(makeContext({ method: 'POST' }))).toBe(true);
    });

    it('GET + admin cookie → 放行（安全方法不改状态）', () => {
      expect(guard.canActivate(makeContext({ method: 'GET', adminCookie: 'at' }))).toBe(true);
    });

    it('HEAD / OPTIONS → 放行', () => {
      expect(guard.canActivate(makeContext({ method: 'HEAD', adminCookie: 'at' }))).toBe(true);
      expect(guard.canActivate(makeContext({ method: 'OPTIONS', adminCookie: 'at' }))).toBe(true);
    });

    it('POST + header === cookie → 放行', () => {
      expect(
        guard.canActivate(
          makeContext({ method: 'POST', adminCookie: 'at', csrfCookie: 'tok', csrfHeader: 'tok' }),
        ),
      ).toBe(true);
    });

    it('PATCH / PUT / DELETE + 匹配 → 放行', () => {
      for (const m of ['PATCH', 'PUT', 'DELETE']) {
        expect(
          guard.canActivate(
            makeContext({ method: m, adminCookie: 'at', csrfCookie: 'c', csrfHeader: 'c' }),
          ),
        ).toBe(true);
      }
    });
  });

  describe('拦截场景（403 E-AUTH-011，经 AllExceptionsFilter 带 traceId）', () => {
    it('POST + admin cookie + 无 X-CSRF-Token header → 403', () => {
      expect(() =>
        guard.canActivate(makeContext({ method: 'POST', adminCookie: 'at', csrfCookie: 'tok' })),
      ).toThrow(ForbiddenException);
    });

    it('POST + 无 csrf cookie（仅 admin cookie）→ 403', () => {
      expect(() =>
        guard.canActivate(makeContext({ method: 'POST', adminCookie: 'at', csrfHeader: 'tok' })),
      ).toThrow(ForbiddenException);
    });

    it('POST + header !== cookie → 403（攻击者猜不到 token）', () => {
      expect(() =>
        guard.canActivate(
          makeContext({ method: 'POST', adminCookie: 'at', csrfCookie: 'tok', csrfHeader: 'wrong' }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('拦截时错误码为 E-AUTH-011', () => {
      try {
        guard.canActivate(makeContext({ method: 'POST', adminCookie: 'at' }));
        expect.fail('CsrfGuard should throw on missing token');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        const resp = (e as ForbiddenException).getResponse() as { code: string };
        expect(resp.code).toBe('E-AUTH-011');
      }
    });
  });
});
