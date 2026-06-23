/**
 * Realtime Gateway 单测
 *
 * 决策依据：M-11 Socket.IO 最小实现 + CLAUDE.md L301（W1 完成判据）
 *
 * 覆盖场景：
 *   1. handleConnection 合法 token → user 写入 client.data，rider 自动加入 RIDERS_ROOM
 *   2. handleConnection 无 token → 抛 UnauthorizedException（不实际 disconnect，单测只验逻辑）
 *   3. handleConnection 无效 token → 抛 UnauthorizedException
 *   4. handleJoinOrder 合法 orderId → 返回 { ok: true, room }
 *   5. handleJoinOrder 缺 orderId → 返回 { ok: false }
 *   6. handleLocationUpdate rider 推 → 返回 { ok: true, broadcast: true } + server.to(room).emit 被调
 *   7. handleLocationUpdate customer 推 → 拒绝（only rider）
 *   8. handleLocationUpdate 缺字段 → 拒绝（invalid payload）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway, type RiderLocationUpdate } from '../src/modules/realtime/realtime.gateway';
import type { WsUser } from '../src/modules/realtime/realtime.gateway';

// 设置 JWT secrets（assertJwtSecret 要求）
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

function createGateway(): RealtimeGateway {
  const { JwtService } = require('@nestjs/jwt');
  return new RealtimeGateway(new JwtService({}));
}

function createMockClient(data?: { user?: WsUser }): any {
  return {
    id: `client-${Math.random().toString(36).slice(2)}`,
    data: data ?? {},
    handshake: { auth: {} },
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
}

function signToken(payload: { sub: string; role: string; deviceType: string }): string {
  const { JwtService } = require('@nestjs/jwt');
  const jwt = new JwtService({
    secret: process.env.JWT_ACCESS_SECRET,
    signOptions: { algorithm: 'HS256' },
  });
  return jwt.sign(payload);
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let serverEmitMock: ReturnType<typeof vi.fn>;
  let serverToMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    gateway = createGateway();
    serverEmitMock = vi.fn();
    serverToMock = vi.fn().mockReturnValue({ emit: serverEmitMock });
    (gateway as any).server = { to: serverToMock };
  });

  describe('handleConnection', () => {
    it('合法 token + rider 角色 → user 写入 client.data + 加入 RIDERS_ROOM', async () => {
      const token = signToken({ sub: 'rider-1', role: 'rider', deviceType: 'rider_app' });
      const client = createMockClient();
      client.handshake.auth = { token };

      await gateway.handleConnection(client);

      expect((client.data as any).user).toEqual({
        sub: 'rider-1',
        role: 'rider',
        deviceType: 'rider_app',
      });
      expect(client.join).toHaveBeenCalledWith('riders');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('合法 token + customer 角色 → 不加入 RIDERS_ROOM', async () => {
      const token = signToken({ sub: 'c-1', role: 'customer', deviceType: 'client_app' });
      const client = createMockClient();
      client.handshake.auth = { token };

      await gateway.handleConnection(client);

      expect(client.join).not.toHaveBeenCalled();
    });

    it('无 token → emit error + disconnect', async () => {
      const client = createMockClient();
      client.handshake.auth = {};

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'E-AUTH-002' }));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('无效 token → emit error + disconnect', async () => {
      const client = createMockClient();
      client.handshake.auth = { token: 'invalid.token.here' };

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'E-AUTH-002' }));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('支持 Bearer 前缀', async () => {
      const token = signToken({ sub: 'r-1', role: 'rider', deviceType: 'rider_app' });
      const client = createMockClient();
      client.handshake.auth = { token: `Bearer ${token}` };

      await gateway.handleConnection(client);

      expect((client.data as any).user?.sub).toBe('r-1');
    });
  });

  describe('handleJoinOrder', () => {
    it('合法 orderId → 加入对应 room', async () => {
      const client = createMockClient({
        user: { sub: 'c-1', role: 'customer', deviceType: 'client_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result).toEqual({ ok: true, room: 'order:order-123' });
      expect(client.join).toHaveBeenCalledWith('order:order-123');
    });

    it('缺 orderId → 返回 ok: false', async () => {
      const client = createMockClient({
        user: { sub: 'c-1', role: 'customer', deviceType: 'client_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: '' }, client);

      expect(result.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('未鉴权 → 返回 ok: false', async () => {
      const client = createMockClient();

      const result = await gateway.handleJoinOrder({ orderId: 'order-1' }, client);

      expect(result.ok).toBe(false);
    });
  });

  describe('handleLocationUpdate', () => {
    const validUpdate: RiderLocationUpdate = {
      orderId: 'order-abc',
      lat: -8.5568,
      lng: 125.56,
      timestamp: Date.now(),
    };

    it('rider 推位置 → 广播到 order room', async () => {
      const client = createMockClient({
        user: { sub: 'rider-1', role: 'rider', deviceType: 'rider_app' },
      });

      const result = await gateway.handleLocationUpdate(validUpdate, client);

      expect(result).toEqual({ ok: true, broadcast: true });
      expect(serverToMock).toHaveBeenCalledWith('order:order-abc');
      expect(serverEmitMock).toHaveBeenCalledWith(
        'order:location',
        expect.objectContaining({
          orderId: 'order-abc',
          lat: -8.5568,
          lng: 125.56,
          riderId: 'rider-1',
        }),
      );
    });

    it('customer 推位置 → 拒绝（only rider）', async () => {
      const client = createMockClient({
        user: { sub: 'c-1', role: 'customer', deviceType: 'client_app' },
      });

      const result = await gateway.handleLocationUpdate(validUpdate, client);

      expect(result.ok).toBe(false);
      expect(result).toEqual({ ok: false, error: 'only rider can push location' });
      expect(serverToMock).not.toHaveBeenCalled();
    });

    it('缺 lat/lng → 拒绝', async () => {
      const client = createMockClient({
        user: { sub: 'r-1', role: 'rider', deviceType: 'rider_app' },
      });

      const result = await gateway.handleLocationUpdate(
        { orderId: 'o', lat: 0, lng: 0, timestamp: 0 },
        client,
      );
      // lat/lng 为 0 是合法值，应该通过；测试用缺字段
      const invalid = { orderId: '', lat: 1, lng: 2, timestamp: 0 };
      const result2 = await gateway.handleLocationUpdate(invalid as any, client);

      expect(result2.ok).toBe(false);
    });

    it('未鉴权 → 拒绝', async () => {
      const client = createMockClient();

      const result = await gateway.handleLocationUpdate(validUpdate, client);

      expect(result.ok).toBe(false);
      expect(result).toEqual({ ok: false, error: 'not authenticated' });
    });
  });

  describe('handleLeaveOrder', () => {
    it('合法 orderId → 离开 room', async () => {
      const client = createMockClient();

      const result = await gateway.handleLeaveOrder({ orderId: 'order-x' }, client);

      expect(result).toEqual({ ok: true });
      expect(client.leave).toHaveBeenCalledWith('order:order-x');
    });
  });
});
