/**
 * refresh-session.ts 单测（W7-ext-H v1.2 Token Family）
 *
 * 测 consumeRefreshSession 解析 Lua 返回 + createRefreshSession/revokeFamily 逻辑。
 * Lua 脚本原子性靠代码审查 + e2e。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    eval: vi.fn(),
    pipeline: vi.fn(() => ({
      set: vi.fn(),
      sadd: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    })),
    get: vi.fn(),
    set: vi.fn(),
    smembers: vi.fn(),
    ttl: vi.fn(),
  },
}));

vi.mock('../src/shared/cache/redis', () => ({ redis: mockRedis }));

import {
  createRefreshSession,
  consumeRefreshSession,
  revokeFamily,
  revokeUserSessions,
  isSessionValid,
  getRefreshSession,
} from '../src/shared/cache/refresh-session';

describe('createRefreshSession', () => {
  beforeEach(() => vi.resetAllMocks());

  it('写 Redis session + family + user 索引', async () => {
    await createRefreshSession({
      jti: 'jti-1',
      familyId: 'fam-1',
      userId: 'user-1',
      deviceType: 'client_app',
      expiresAt: Date.now() + 60000,
    });
    expect(mockRedis.pipeline).toHaveBeenCalled();
  });
});

describe('consumeRefreshSession', () => {
  beforeEach(() => vi.resetAllMocks());

  it('OK: active -> used', async () => {
    mockRedis.eval.mockResolvedValue(
      JSON.stringify({
        status: 'OK',
        session: {
          familyId: 'fam-1',
          userId: 'user-1',
          status: 'used',
          deviceType: 'client_app',
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000,
          usedAt: Date.now(),
        },
      }),
    );
    const r = await consumeRefreshSession('jti-1');
    expect(r.status).toBe('OK');
    if (r.status === 'OK') {
      expect(r.session.familyId).toBe('fam-1');
    }
  });

  it('INVALID: jti 不存在', async () => {
    mockRedis.eval.mockResolvedValue(JSON.stringify({ status: 'INVALID' }));
    const r = await consumeRefreshSession('jti-x');
    expect(r.status).toBe('INVALID');
  });

  it('EXPIRED: session 过期', async () => {
    mockRedis.eval.mockResolvedValue(JSON.stringify({ status: 'EXPIRED' }));
    const r = await consumeRefreshSession('jti-1');
    expect(r.status).toBe('EXPIRED');
  });

  it('REVOKED: session 已撤销', async () => {
    mockRedis.eval.mockResolvedValue(JSON.stringify({ status: 'REVOKED' }));
    const r = await consumeRefreshSession('jti-1');
    expect(r.status).toBe('REVOKED');
  });

  it('REPLAY: 旧 token 重放 -> 撤销整个 family', async () => {
    mockRedis.eval.mockResolvedValue(JSON.stringify({ status: 'REPLAY', familyId: 'fam-1' }));
    const r = await consumeRefreshSession('jti-1');
    expect(r.status).toBe('REPLAY');
    if (r.status === 'REPLAY') {
      expect(r.familyId).toBe('fam-1');
    }
  });
});

describe('revokeFamily', () => {
  beforeEach(() => vi.resetAllMocks());

  it('遍历 family 所有 jti 标记 revoked', async () => {
    mockRedis.smembers.mockResolvedValue(['jti-1', 'jti-2']);
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        familyId: 'fam-1',
        userId: 'user-1',
        status: 'active',
        deviceType: 'client_app',
        createdAt: 0,
        expiresAt: Date.now() + 60000,
      }),
    );
    mockRedis.ttl.mockResolvedValue(3600);
    await revokeFamily('fam-1');
    expect(mockRedis.smembers).toHaveBeenCalledWith('refresh:family:fam-1');
    expect(mockRedis.set).toHaveBeenCalledTimes(2); // 2 个 jti 标记 revoked
  });

  it('family 无成员 -> 不操作', async () => {
    mockRedis.smembers.mockResolvedValue([]);
    await revokeFamily('fam-empty');
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

describe('revokeUserSessions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('遍历该用户所有 family 撤销', async () => {
    mockRedis.smembers.mockResolvedValueOnce(['fam-1', 'fam-2']); // refresh:user:{userId}
    mockRedis.smembers.mockResolvedValueOnce([]); // refresh:family:fam-1
    mockRedis.smembers.mockResolvedValueOnce([]); // refresh:family:fam-2
    await revokeUserSessions('user-1');
    expect(mockRedis.smembers).toHaveBeenCalledWith('refresh:user:user-1');
    // 调 revokeFamily 2 次（fam-1 + fam-2）
    expect(mockRedis.smembers).toHaveBeenCalledWith('refresh:family:fam-1');
    expect(mockRedis.smembers).toHaveBeenCalledWith('refresh:family:fam-2');
  });
});

describe('isSessionValid', () => {
  beforeEach(() => vi.resetAllMocks());

  it('session active + 未过期 -> true', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        familyId: 'fam-1',
        userId: 'user-1',
        status: 'active',
        deviceType: 'client_app',
        createdAt: 0,
        expiresAt: Date.now() + 60000,
      }),
    );
    expect(await isSessionValid('jti-1')).toBe(true);
  });

  it('session revoked -> false', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        familyId: 'fam-1',
        userId: 'user-1',
        status: 'revoked',
        deviceType: 'client_app',
        createdAt: 0,
        expiresAt: Date.now() + 60000,
      }),
    );
    expect(await isSessionValid('jti-1')).toBe(false);
  });

  it('session 不存在 -> false', async () => {
    mockRedis.get.mockResolvedValue(null);
    expect(await isSessionValid('jti-x')).toBe(false);
  });

  it('session 过期 -> false', async () => {
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        familyId: 'fam-1',
        userId: 'user-1',
        status: 'active',
        deviceType: 'client_app',
        createdAt: 0,
        expiresAt: Date.now() - 1000, // 已过期
      }),
    );
    expect(await isSessionValid('jti-1')).toBe(false);
  });
});

describe('getRefreshSession', () => {
  beforeEach(() => vi.resetAllMocks());

  it('存在 -> 返回 session', async () => {
    const session = {
      familyId: 'fam-1',
      userId: 'user-1',
      status: 'active',
      deviceType: 'client_app',
      createdAt: 0,
      expiresAt: Date.now() + 60000,
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(session));
    const r = await getRefreshSession('jti-1');
    expect(r).toEqual(session);
  });

  it('不存在 -> null', async () => {
    mockRedis.get.mockResolvedValue(null);
    const r = await getRefreshSession('jti-x');
    expect(r).toBeNull();
  });
});
