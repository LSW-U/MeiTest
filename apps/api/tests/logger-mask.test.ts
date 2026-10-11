/**
 * logger maskObject 单测（后端配置门禁修复 批2 P2-D6）
 *
 * 覆盖：
 *   - 含匹配：嵌套对象 accessToken / refreshToken 命中 [REDACTED]（D6 缺口修复）
 *   - 既有键行为不回退：password / authorization / clientsecret / token 仍全 mask
 *   - LAST4 键：phone 仍 last-4 部分脱敏
 *   - 误伤面评估（见文末注释）：含 token/secret 子串的非敏感键（如 tokensUsed）会一并 mask——
 *     接受该误伤（日志多 mask 一处无害，漏 mask 一处即泄漏），方案 D6 已拍板
 *
 * 实现注记：maskObject 未导出，经 wrapWithMask 后的 logger.info 间接验证——
 * mock pino base logger 捕获 masked 参数。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('pino', () => {
  const base = {
    level: 'debug',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  return { default: vi.fn(() => base) };
});

import pino from 'pino';
import { logger } from '../src/shared/logger/logger';

// pino() 只在模块加载时调用一次，拿回同一 base mock。
// 注意：不能 spyOn(logger,'info')——那包在 masked wrapper 外层，看到的都是 mask 前
// 的原始参数；mask 结果要断言 wrapper 传给 base pino 的第二手参数。
const baseMock = vi.mocked(pino).mock.results[0]!.value as {
  info: ReturnType<typeof vi.fn>;
};

describe('logger mask（P2-D6 含匹配）', () => {
  it('嵌套对象 accessToken 命中 → [REDACTED]', () => {
    logger.info({ auth: { accessToken: 'secret-jwt-value' } }, 'test');
    const arg = baseMock.info.mock.calls.at(-1)![0] as Record<string, { accessToken: string }>;
    expect(arg.auth.accessToken).toBe('[REDACTED]');
  });

  it('顶层 refreshToken 命中 → [REDACTED]', () => {
    logger.info({ refreshToken: 'r-123' }, 'test');
    const arg = baseMock.info.mock.calls.at(-1)![0] as Record<string, string>;
    expect(arg.refreshToken).toBe('[REDACTED]');
  });

  it('既有键不回退：password / authorization / clientsecret / token / apiKey 仍全 mask', () => {
    logger.info(
      {
        password: 'p1',
        Authorization: 'Bearer x',
        clientSecret: 'cs1',
        token: 't1',
        apiKey: 'k1',
      },
      'test',
    );
    const arg = baseMock.info.mock.calls.at(-1)![0] as Record<string, string>;
    expect(arg.password).toBe('[REDACTED]');
    expect(arg.Authorization).toBe('[REDACTED]');
    expect(arg.clientSecret).toBe('[REDACTED]');
    expect(arg.token).toBe('[REDACTED]');
    expect(arg.apiKey).toBe('[REDACTED]');
  });

  it('LAST4 键不回退：phone 仍 last-4 部分脱敏', () => {
    logger.info({ phone: '+67088888001' }, 'test');
    const arg = baseMock.info.mock.calls.at(-1)![0] as Record<string, string>;
    expect(arg.phone).toBe('***8001');
  });

  it('误伤面：tokensUsed（含 token 子串）一并 mask——接受误伤（D6 拍板）', () => {
    logger.info({ tokensUsed: 42 }, 'test');
    const arg = baseMock.info.mock.calls.at(-1)![0] as Record<string, string>;
    expect(arg.tokensUsed).toBe('[REDACTED]');
  });

  it('普通键不受影响', () => {
    logger.info({ userId: 'u1', action: 'LOGIN' }, 'test');
    const arg = baseMock.info.mock.calls.at(-1)![0] as Record<string, string>;
    expect(arg.userId).toBe('u1');
    expect(arg.action).toBe('LOGIN');
  });
});
