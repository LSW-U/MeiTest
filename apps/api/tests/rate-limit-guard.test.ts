/**
 * RateLimitGuard.resolveKey 单测（P17 审查 P1 修复补测，2026-08-17；批A R9 归一化追加 2026-09-15）
 *
 * 重点：${user.field} 模板（修复前不存在此分支，${user.sub} 字面量进 Redis 反向锁死全站）。
 * resolveKey 是 private，用 (guard as any) 直调（白盒测模板解析，不经 canActivate 全链路）。
 *
 * 批A R9：phone/newPhone 先 normalizePhoneE164 再 hash——同号异形
 * （+670 7xx xxxx / +6707xxxxxxx / 00670...）归一化后同桶，堵限流绕过。
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import type { Reflector } from '@nestjs/core';
import { RateLimitGuard } from '../src/shared/guards/rate-limit.guard';

const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

/** 与 guard 内部一致的归一化 hash（截 16 位） */
function phoneHash(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 16);
}

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

  it('${body.phone} SHA256 hash 不受影响（E.164 直传，原有分支回归）', () => {
    const key = resolve('sms:phone:${body.phone}', { body: { phone: '+67077777777' } });
    expect(key).toBe(`sms:phone:${phoneHash('+67077777777')}`);
  });
});

describe('RateLimitGuard.resolveKey phone 归一化（批A R9）', () => {
  const guard = new RateLimitGuard(reflector);
  const resolvePhone = (phone: unknown, field = 'phone') =>
    (guard as unknown as { resolveKey: (t: string, r: any, ip: string) => string }).resolveKey(
      `sms:phone:\${body.${field}}`,
      { body: { [field]: phone } },
      '1.2.3.4',
    );

  it('同号异形归一化同桶：+670 7777 7777 / +670-7777-7777 / 0067077777777 -> 同 key', () => {
    const spaced = resolvePhone('+670 7777 7777');
    const dashed = resolvePhone('+670-7777-7777');
    const doubleZero = resolvePhone('0067077777777');
    const canonical = resolvePhone('+67077777777');
    expect(spaced).toBe(canonical);
    expect(dashed).toBe(canonical);
    expect(doubleZero).toBe(canonical);
    expect(canonical).toBe(`sms:phone:${phoneHash('+67077777777')}`);
  });

  it('newPhone 字段同样归一化（换绑链路限流键统一形态）', () => {
    const raw = resolvePhone('+670 7777 7777', 'newPhone');
    expect(raw).toBe(`sms:phone:${phoneHash('+67077777777')}`);
  });

  it('非法 phone（schema 会 400）-> unknown 桶，限流仍记账不放行', () => {
    expect(resolvePhone('not-a-phone')).toBe('sms:phone:unknown');
    expect(resolvePhone('12345')).toBe('sms:phone:unknown');
  });

  it('空/缺 phone -> unknown 兜底（原语义保持）', () => {
    expect(resolvePhone('')).toBe('sms:phone:unknown');
    expect((guard as unknown as { resolveKey: (t: string, r: any, ip: string) => string })
      .resolveKey('sms:phone:${body.phone}', { body: {} }, '1.2.3.4')).toBe('sms:phone:unknown');
  });

  it('非 phone 字段不做归一化（email 等 hash 原值，防误伤）', () => {
    const key = (guard as unknown as { resolveKey: (t: string, r: any, ip: string) => string })
      .resolveKey('x:${body.email}', { body: { email: 'a b@c' } }, '1.2.3.4');
    expect(key).toBe(`x:${createHash('sha256').update('a b@c').digest('hex').slice(0, 16)}`);
  });
});

