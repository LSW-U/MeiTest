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
  listUserSessions,
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

// ===== P17 B2.3 listUserSessions（2026-08-17，审查 P2 补测）=====

describe('listUserSessions (P17 B2.3)', () => {
  beforeEach(() => vi.resetAllMocks());

  const session = (familyId: string, jti: string, createdAt: number) =>
    JSON.stringify({
      familyId,
      userId: 'user-1',
      status: 'active',
      deviceType: 'client_app',
      createdAt,
      expiresAt: createdAt + 86400000,
    });

  it('单 family 单 jti -> 返一条', async () => {
    mockRedis.smembers
      .mockResolvedValueOnce(['fam-1']) // user 索引
      .mockResolvedValueOnce(['jti-1']); // family 索引
    mockRedis.get.mockResolvedValueOnce(session('fam-1', 'jti-1', 1000));
    const result = await listUserSessions('user-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ familyId: 'fam-1', deviceType: 'client_app', status: 'active' });
  });

  it('同 family 多 jti（refresh 轮换历史）-> 只返最新 createdAt 一条', async () => {
    mockRedis.smembers
      .mockResolvedValueOnce(['fam-1'])
      .mockResolvedValueOnce(['jti-old', 'jti-new']);
    mockRedis.get
      .mockResolvedValueOnce(session('fam-1', 'jti-old', 1000))
      .mockResolvedValueOnce(session('fam-1', 'jti-new', 2000));
    const result = await listUserSessions('user-1');
    expect(result).toHaveLength(1);
    // 返原始 number createdAt（ISO 转换在 controller 层做）
    expect(result[0].createdAt).toBe(2000);
  });

  it('family 内全部 session 已被 TTL 驱逐 -> 跳过该 family', async () => {
    mockRedis.smembers
      .mockResolvedValueOnce(['fam-gone', 'fam-live'])
      .mockResolvedValueOnce(['jti-x']) // fam-gone
      .mockResolvedValueOnce(['jti-y']); // fam-live
    mockRedis.get
      .mockResolvedValueOnce(null) // fam-gone 唯一 jti 已驱逐
      .mockResolvedValueOnce(session('fam-live', 'jti-y', 3000));
    const result = await listUserSessions('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].familyId).toBe('fam-live');
  });

  it('多 family -> 按 createdAt 降序（最新登录在前）', async () => {
    mockRedis.smembers
      .mockResolvedValueOnce(['fam-old', 'fam-new'])
      .mockResolvedValueOnce(['jti-a'])
      .mockResolvedValueOnce(['jti-b']);
    mockRedis.get
      .mockResolvedValueOnce(session('fam-old', 'jti-a', 1000))
      .mockResolvedValueOnce(session('fam-new', 'jti-b', 5000));
    const result = await listUserSessions('user-1');
    expect(result.map((s) => s.familyId)).toEqual(['fam-new', 'fam-old']);
  });

  it('用户无任何 family -> 空数组', async () => {
    mockRedis.smembers.mockResolvedValueOnce([]);
    const result = await listUserSessions('user-1');
    expect(result).toEqual([]);
  });
});
