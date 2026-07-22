/**
 * Cookie Helper 单测（约束 6：admin_web httpOnly cookie 双通道鉴权）
 *
 * 核心安全断言：
 *   1. admin_web 登录/刷新 → set httpOnly + secure(prod) + sameSite=lax + path=/api/v1 cookie
 *   2. CUSTOMER/RIDER（client_app/rider_app）→ 绝不 set cookie（防移动端 token 进 cookie jar 被 XSS 窃取）
 *   3. logout → clear cookie（幂等，移动端调到也安全）
 *   4. refresh/logout 双通道：从 cookie 读 token
 */
import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import {
  setAuthCookiesForDevice,
  clearAuthCookies,
  getRefreshTokenFromCookie,
  getAccessTokenFromCookie,
} from '../src/shared/auth/cookie-helper';

/** 造一个 mock Express Response（只含 cookie/clearCookie） */
function mockRes(): Pick<Response, 'cookie' | 'clearCookie'> {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

const TOKENS = {
  accessToken: 'access-xxx',
  refreshToken: 'refresh-yyy',
  accessExpiresAt: 1700007200,
  refreshExpiresAt: 1705184000,
};

describe('cookie-helper', () => {
  describe('setAuthCookiesForDevice — deviceType 门控', () => {
    it('admin_web → set access + refresh 两个 cookie', () => {
      const res = mockRes();
      setAuthCookiesForDevice(res as Response, 'admin_web', TOKENS);
      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(res.cookie).toHaveBeenCalledWith('admin_access_token', TOKENS.accessToken, expect.any(Object));
      expect(res.cookie).toHaveBeenCalledWith('admin_refresh_token', TOKENS.refreshToken, expect.any(Object));
    });

    it('client_app（CUSTOMER）→ 绝不 set cookie（防移动端 token 进 cookie jar）', () => {
      const res = mockRes();
      setAuthCookiesForDevice(res as Response, 'client_app', TOKENS);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('rider_app（RIDER）→ 绝不 set cookie', () => {
      const res = mockRes();
      setAuthCookiesForDevice(res as Response, 'rider_app', TOKENS);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('setAuthCookiesForDevice — cookie 安全属性', () => {
    it('httpOnly + sameSite=lax + path=/api/v1（防 XSS 读 + 防 CSRF）', () => {
      const res = mockRes();
      setAuthCookiesForDevice(res as Response, 'admin_web', TOKENS);
      const expectedAttrs = { httpOnly: true, sameSite: 'lax', path: '/api/v1' };
      expect(res.cookie).toHaveBeenCalledWith(
        'admin_access_token',
        expect.any(String),
        expect.objectContaining(expectedAttrs),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'admin_refresh_token',
        expect.any(String),
        expect.objectContaining(expectedAttrs),
      );
    });

    it('secure: development → false（localhost 调试用）', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const res = mockRes();
      setAuthCookiesForDevice(res as Response, 'admin_web', TOKENS);
      expect(res.cookie).toHaveBeenCalledWith(
        'admin_access_token',
        expect.any(String),
        expect.objectContaining({ secure: false }),
      );
      process.env.NODE_ENV = prev;
    });

    it('secure: production → true（强制 HTTPS，防中间人窃取 cookie）', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const res = mockRes();
      setAuthCookiesForDevice(res as Response, 'admin_web', TOKENS);
      expect(res.cookie).toHaveBeenCalledWith(
        'admin_access_token',
        expect.any(String),
        expect.objectContaining({ secure: true }),
      );
      process.env.NODE_ENV = prev;
    });
  });

  describe('clearAuthCookies', () => {
    it('clear access + refresh cookie（logout 用，幂等）', () => {
      const res = mockRes();
      clearAuthCookies(res as Response);
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      expect(res.clearCookie).toHaveBeenCalledWith('admin_access_token', { path: '/api/v1' });
      expect(res.clearCookie).toHaveBeenCalledWith('admin_refresh_token', { path: '/api/v1' });
    });
  });

  describe('双通道 cookie 读取（refresh/logout 端点用）', () => {
    it('getRefreshTokenFromCookie 读 admin_refresh_token', () => {
      expect(getRefreshTokenFromCookie({ cookies: { admin_refresh_token: 'rt' } })).toBe('rt');
    });

    it('getAccessTokenFromCookie 读 admin_access_token（JwtStrategy 用）', () => {
      expect(getAccessTokenFromCookie({ cookies: { admin_access_token: 'at' } })).toBe('at');
    });

    it('无 cookies 对象 → null（移动端无 cookie 场景）', () => {
      expect(getRefreshTokenFromCookie({})).toBeNull();
      expect(getAccessTokenFromCookie({})).toBeNull();
    });

    it('cookie 不存在 → null', () => {
      expect(getRefreshTokenFromCookie({ cookies: {} })).toBeNull();
      expect(getAccessTokenFromCookie({ cookies: { other: 'x' } })).toBeNull();
    });
  });
});
