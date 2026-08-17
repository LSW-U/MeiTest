/**
 * RateLimitGuard.resolveKey 单测（P17 审查 P1 修复补测，2026-08-17）
 *
 * 重点：${user.field} 模板（修复前不存在此分支，${user.sub} 字面量进 Redis 反向锁死全站）。
 * resolveKey 是 private，用 (guard as any) 直调（白盒测模板解析，不经 canActivate 全链路）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../src/shared/guards/rate-limit.guard';

const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

describe('RateLimitGuard.resolveKey（P17 审查 P1 修复）', () => {
  const guard = new RateLimitGuard(reflector);
  const resolve = (template: string, request: any) =>
    (guard as unknown as { resolveKey: (t: string, r: any, ip: string) => string }).resolveKey(
      template,
      request,
      '1.2.3.4',
    );

  it('${user.sub} 登录态 -> 解析为 user.sub 值（修复前是字面量 ${user.sub}）', () => {
    const key = resolve('chpwd:user:${user.sub}', { user: { sub: 'user-abc' } });
    expect(key).toBe('chpwd:user:user-abc');
  });

  it('${user.sub} @Public 端点（request.user undefined）-> anonymous 兜底', () => {
    const key = resolve('chpwd:user:${user.sub}', { user: undefined });
    expect(key).toBe('chpwd:user:anonymous');
  });

  it('${ip} 不受影响（原有分支回归）', () => {
    const key = resolve('chpwd:ip:${ip}', {});
    expect(key).toBe('chpwd:ip:1.2.3.4');
  });

  it('${body.phone} SHA256 hash 不受影响（原有分支回归）', () => {
    const key = resolve('sms:phone:${body.phone}', { body: { phone: '+67077777777' } });
    expect(key).toMatch(/^sms:phone:[a-f0-9]{16}$/);
  });
});
