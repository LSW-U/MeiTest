/**
 * CSRF Middleware 单测（约束 6：admin-web httpOnly cookie 配套 CSRF 防护）
 *
 * 核心断言：
 *   1. 无 admin cookie（移动端 Bearer / 登录前）→ 放行（移动端无 CSRF 风险）
 *   2. GET / HEAD / OPTIONS → 放行（安全方法）
 *   3. mutate + admin cookie + header 缺失/不匹配 → 403 E-AUTH-011
 *   4. mutate + header === cookie → 放行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CsrfMiddleware } from '../src/shared/middleware/csrf.middleware';

interface MakeReqOpts {
  method?: string;
  adminCookie?: string;
  csrfCookie?: string;
  csrfHeader?: string;
}

function makeReq(opts: MakeReqOpts) {
  const cookies: Record<string, string> = {};
  if (opts.adminCookie !== undefined) cookies.admin_access_token = opts.adminCookie;
  if (opts.csrfCookie !== undefined) cookies.admin_csrf = opts.csrfCookie;
  const headers: Record<string, string> = {};
  if (opts.csrfHeader !== undefined) headers['x-csrf-token'] = opts.csrfHeader;
  return { method: opts.method ?? 'GET', cookies, headers } as any;
}

describe('CsrfMiddleware', () => {
  const mw = new CsrfMiddleware();
  const res = {} as any;
  const next = vi.fn();

  beforeEach(() => next.mockReset());

  describe('放行场景', () => {
    it('无 admin cookie（移动端 Bearer / 登录前请求）→ 放行', () => {
      mw.use(makeReq({ method: 'POST' }), res, next); // 无 adminCookie
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('GET + admin cookie → 放行（安全方法不改状态）', () => {
      mw.use(makeReq({ method: 'GET', adminCookie: 'at' }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('HEAD / OPTIONS → 放行', () => {
      mw.use(makeReq({ method: 'HEAD', adminCookie: 'at' }), res, next);
      mw.use(makeReq({ method: 'OPTIONS', adminCookie: 'at' }), res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('POST + admin cookie + header === cookie → 放行', () => {
      mw.use(
        makeReq({ method: 'POST', adminCookie: 'at', csrfCookie: 'tok', csrfHeader: 'tok' }),
        res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('PATCH / PUT / DELETE + header === cookie → 放行', () => {
      for (const m of ['PATCH', 'PUT', 'DELETE']) {
        mw.use(
          makeReq({ method: m, adminCookie: 'at', csrfCookie: 'c', csrfHeader: 'c' }),
          res,
          next,
        );
      }
      expect(next).toHaveBeenCalledTimes(3);
    });
  });

  describe('拦截场景（403 E-AUTH-011）', () => {
    it('POST + admin cookie + 无 X-CSRF-Token header → 403', () => {
      expect(() =>
        mw.use(makeReq({ method: 'POST', adminCookie: 'at', csrfCookie: 'tok' }), res, next),
      ).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('POST + 无 csrf cookie（仅 admin cookie）→ 403', () => {
      expect(() =>
        mw.use(makeReq({ method: 'POST', adminCookie: 'at', csrfHeader: 'tok' }), res, next),
      ).toThrow(ForbiddenException);
    });

    it('POST + header !== cookie → 403（攻击者猜不到 token）', () => {
      expect(() =>
        mw.use(
          makeReq({ method: 'POST', adminCookie: 'at', csrfCookie: 'tok', csrfHeader: 'wrong' }),
          res,
          next,
        ),
      ).toThrow(ForbiddenException);
    });

    it('拦截时错误码为 E-AUTH-011', () => {
      try {
        mw.use(makeReq({ method: 'POST', adminCookie: 'at' }), res, next);
        expect.fail('CsrfMiddleware should throw on missing token');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        const resp = (e as ForbiddenException).getResponse() as { code: string };
        expect(resp.code).toBe('E-AUTH-011');
      }
    });
  });
});
