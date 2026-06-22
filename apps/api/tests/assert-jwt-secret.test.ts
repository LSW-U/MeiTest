/**
 * P0-1 单测：JWT secret bootstrap 校验
 *
 * 决策依据：W1 审查报告 P0-1
 *   - 空 secret 不应通过（原 `?? ''` bug 重现防护）
 *   - < 32 字符不应通过
 *   - 错误信息含 envName + 当前长度，便于运维定位
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { assertJwtSecret, assertAllJwtSecrets } from '../src/shared/auth/assert-jwt-secret';

const VALID_ACCESS = 'a'.repeat(32);
const VALID_REFRESH = 'r'.repeat(32);

describe('assertJwtSecret', () => {
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  it('长度 ≥ 32 的 secret 通过校验', () => {
    process.env.JWT_ACCESS_SECRET = VALID_ACCESS;
    expect(assertJwtSecret('JWT_ACCESS_SECRET')).toBe(VALID_ACCESS);
  });

  it('恰好 32 字符也通过（边界）', () => {
    process.env.JWT_ACCESS_SECRET = 'b'.repeat(32);
    expect(assertJwtSecret('JWT_ACCESS_SECRET')).toHaveLength(32);
  });

  it('未设 env 时抛错（错误指向 env var missing）', () => {
    expect(() => assertJwtSecret('JWT_ACCESS_SECRET')).toThrow(
      /JWT_ACCESS_SECRET is not set \(env var missing\)/,
    );
  });

  it('空字符串 env 时抛错（P0-1 原 `?? ""` 漏掉的边界，错误指向长度）', () => {
    process.env.JWT_ACCESS_SECRET = '';
    expect(() => assertJwtSecret('JWT_ACCESS_SECRET')).toThrow(
      /must be >= 32 chars \(current: 0\)/,
    );
  });

  it('长度 < 32 抛错且错误信息含当前长度', () => {
    process.env.JWT_ACCESS_SECRET = 'short';
    expect(() => assertJwtSecret('JWT_ACCESS_SECRET')).toThrow(
      /must be >= 32 chars \(current: 5\)/,
    );
  });

  it('refresh secret 同样校验', () => {
    process.env.JWT_REFRESH_SECRET = VALID_REFRESH;
    expect(assertJwtSecret('JWT_REFRESH_SECRET')).toBe(VALID_REFRESH);
  });
});

describe('assertAllJwtSecrets', () => {
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  it('两个 secret 都合法时通过', () => {
    process.env.JWT_ACCESS_SECRET = VALID_ACCESS;
    process.env.JWT_REFRESH_SECRET = VALID_REFRESH;
    expect(() => assertAllJwtSecrets()).not.toThrow();
  });

  it('access 漏配时抛错（指向 access）', () => {
    process.env.JWT_REFRESH_SECRET = VALID_REFRESH;
    expect(() => assertAllJwtSecrets()).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refresh 漏配时抛错（指向 refresh）', () => {
    process.env.JWT_ACCESS_SECRET = VALID_ACCESS;
    expect(() => assertAllJwtSecrets()).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('错误信息含生成命令提示', () => {
    expect(() => assertAllJwtSecrets()).toThrow(/openssl rand -base64 48/);
  });
});
