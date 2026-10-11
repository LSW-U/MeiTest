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
import { db } from '../src/shared/db';

// 设置 JWT secrets（assertJwtSecret 要求）
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

// P1-9 修复后 handleLocationUpdate 调 db.order.findUnique 校验 riderId 绑定；
// P1-3 join:order 参与断言同样查 order（select userId+riderId），默认返回参与双方
// P1-2（20261012 审查修复）：RIDER 分支经 db.riderProfile.findUnique 把 User.id(sub)
// 转 RiderProfile.id 再比对（Order.riderId 存 profile id）——默认 mock：sub 'rider-1'
// → profile id 'profile-rider-1'，与 order.riderId='profile-rider-1' 匹配
vi.mock('../src/shared/db', () => ({
  db: {
    order: {
      findUnique: vi.fn().mockResolvedValue({ userId: 'c-1', riderId: 'profile-rider-1' }),
    },
    riderProfile: {
      findUnique: vi.fn().mockResolvedValue({ id: 'profile-rider-1' }),
    },
  },
}));

// 批B P3-4：隔离 rider-location.store（REDIS_URL 缺失时走真实 store 的 catch 路径，
// 产生 RIDER_LOC_PERSIST_FAILED 告警噪音）；mock 后可断言 persist 调用参数
const { persistRiderLocationMock } = vi.hoisted(() => ({
  persistRiderLocationMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/modules/rider/rider-location.store', () => ({
  persistRiderLocation: persistRiderLocationMock,
}));

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
    // P2-1（审查 2026-10-11）：db.order.findUnique 是模块级共享 mock，每个用例前显式重置
    // 为默认值，防 mockResolvedValueOnce 排队未消费 / 用例顺序变化导致跨 describe 串值
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockReset();
    (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 'c-1',
      // P1-2：riderId = RiderProfile.id（'profile-rider-1'），非 User.id
      riderId: 'profile-rider-1',
    });
    (db.riderProfile.findUnique as ReturnType<typeof vi.fn>).mockReset();
    (db.riderProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'profile-rider-1',
    });
    gateway = createGateway();
    serverEmitMock = vi.fn();
    serverToMock = vi.fn().mockReturnValue({ emit: serverEmitMock });
    (gateway as any).server = { to: serverToMock };
  });

  describe('handleConnection', () => {
    it('合法 token + rider 角色 → user 写入 client.data + 加入 RIDERS_ROOM', async () => {
      const token = signToken({ sub: 'rider-1', role: 'RIDER', deviceType: 'rider_app' });
      const client = createMockClient();
      client.handshake.auth = { token };

      await gateway.handleConnection(client);

      expect((client.data as any).user).toEqual({
        sub: 'rider-1',
        role: 'RIDER',
        deviceType: 'rider_app',
      });
      expect(client.join).toHaveBeenCalledWith('riders');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('合法 token + customer 角色 → 不加入 RIDERS_ROOM', async () => {
      const token = signToken({ sub: 'c-1', role: 'CUSTOMER', deviceType: 'client_app' });
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
      const token = signToken({ sub: 'r-1', role: 'RIDER', deviceType: 'rider_app' });
      const client = createMockClient();
      client.handshake.auth = { token: `Bearer ${token}` };

      await gateway.handleConnection(client);

      expect((client.data as any).user?.sub).toBe('r-1');
    });
  });

  describe('handleJoinOrder', () => {
    it('订单顾客 join → 加入对应 room', async () => {
      const client = createMockClient({
        user: { sub: 'c-1', role: 'CUSTOMER', deviceType: 'client_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result).toEqual({ ok: true, room: 'order:order-123' });
      expect(client.join).toHaveBeenCalledWith('order:order-123');
    });

    it('被派骑手 join → 放行（P1-2：sub=User.id 经 riderProfile 转换后与 riderId=profile.id 比对）', async () => {
      const client = createMockClient({
        user: { sub: 'rider-1', role: 'RIDER', deviceType: 'rider_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result).toEqual({ ok: true, room: 'order:order-123' });
      expect(client.join).toHaveBeenCalledWith('order:order-123');
      // P1-2 断言：确实走了 profile 转换（sub → RiderProfile.id）
      expect(db.riderProfile.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'rider-1' } }),
      );
    });

    it('SUPER_ADMIN 放行（平台监管，对齐 im:join 口径）', async () => {
      const client = createMockClient({
        user: { sub: 'admin-1', role: 'SUPER_ADMIN', deviceType: 'admin_web' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result).toEqual({ ok: true, room: 'order:order-123' });
      expect(client.join).toHaveBeenCalledWith('order:order-123');
    });

    it('CUSTOMER_SERVICE 放行（客服介入，对齐 im:join 口径）', async () => {
      const client = createMockClient({
        user: { sub: 'cs-1', role: 'CUSTOMER_SERVICE', deviceType: 'admin_web' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result).toEqual({ ok: true, room: 'order:order-123' });
    });

    it('非参与者顾客 join → 拒绝 + 不 join + 不外泄原因', async () => {
      const client = createMockClient({
        user: { sub: 'stranger-1', role: 'CUSTOMER', deviceType: 'client_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result).toEqual({ ok: false, error: 'forbidden: not an order participant' });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('未派单骑手 join → 拒绝（riderId 非本人 profile）', async () => {
      (db.riderProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'profile-someone-else',
      });
      const client = createMockClient({
        user: { sub: 'rider-other', role: 'RIDER', deviceType: 'rider_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('骑手无 profile → 拒绝（P1-2：resolveRiderProfileId 查无即 fail-closed）', async () => {
      (db.riderProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const client = createMockClient({
        user: { sub: 'rider-noprofile', role: 'RIDER', deviceType: 'rider_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-123' }, client);

      expect(result.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('订单不存在 → 拒绝', async () => {
      (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const client = createMockClient({
        user: { sub: 'c-1', role: 'CUSTOMER', deviceType: 'client_app' },
      });

      const result = await gateway.handleJoinOrder({ orderId: 'order-404' }, client);

      expect(result.ok).toBe(false);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('缺 orderId → 返回 ok: false', async () => {
      const client = createMockClient({
        user: { sub: 'c-1', role: 'CUSTOMER', deviceType: 'client_app' },
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

    it('rider 推位置 → 广播到 order room（D9：guard 经 profile 转换后比对 riderId）', async () => {
      const client = createMockClient({
        user: { sub: 'rider-1', role: 'RIDER', deviceType: 'rider_app' },
      });
      // D9（20261012）：assertRiderOwnsOrder 已修复——riderProfile.findUnique 把
      // sub='rider-1' 转 profile id 'profile-rider-1' 再与 order.riderId 比对，
      // 此用例 mock 与 join:order 的 profile mock 对齐（撤销批2 收尾时的临时回退）
      (db.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: 'c-1',
        riderId: 'profile-rider-1',
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
      // 批B：配送中分支也落 rider:loc（带 orderId → 短 TTL）
      expect(persistRiderLocationMock).toHaveBeenCalledWith('rider-1', -8.5568, 125.56, 'order-abc');
    });

    it('customer 推位置 → 拒绝（only rider）', async () => {
      const client = createMockClient({
        user: { sub: 'c-1', role: 'CUSTOMER', deviceType: 'client_app' },
      });

      const result = await gateway.handleLocationUpdate(validUpdate, client);

      expect(result.ok).toBe(false);
      expect(result).toEqual({ ok: false, error: 'only rider can push location' });
      expect(serverToMock).not.toHaveBeenCalled();
    });

    it('缺 lat/lng → 拒绝；空 orderId + 合法坐标 → 等单期仅落 Redis（R12）', async () => {
      const client = createMockClient({
        user: { sub: 'r-1', role: 'RIDER', deviceType: 'rider_app' },
      });

      // 真缺字段（lat/lng 非数字）→ 拒绝
      const invalid = { orderId: 'o', timestamp: 0 };
      const result = await gateway.handleLocationUpdate(invalid as any, client);
      expect(result.ok).toBe(false);

      // 空 orderId 是合法等单期上报（R12：orderId 可选）→ 仅落 rider:loc，不广播
      const idle = { orderId: '', lat: 1, lng: 2, timestamp: 0 };
      const result2 = await gateway.handleLocationUpdate(idle as any, client);
      expect(result2).toEqual({ ok: true, persisted: true });
      expect(serverToMock).not.toHaveBeenCalled();
      // P3-4：断言 persist 参数——riderId=JWT sub、坐标原样透传、空 orderId 不入参
      expect(persistRiderLocationMock).toHaveBeenCalledWith('r-1', 1, 2);
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
