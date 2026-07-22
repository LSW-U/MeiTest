/**
 * RealtimeGateway IM 事件单测（流程 M W3）
 *
 * 覆盖场景：
 *   1. im:join 合法 conversationId → client.join 被调 + 返回 ok
 *   2. im:join 非法 conversationId（不以 conv: 开头）→ ok: false
 *   3. im:join 未认证 → ok: false
 *   4. im:send 合法 → server.to(conv).emit('im:message') + Redis rpush + incr 未读
 *   5. im:send 内容超 2000 字符 → ok: false
 *   6. im:read → Redis del 未读 key
 *   7. extractOtherUserId 解析三方会话 ID
 *
 * 决策依据：W2-M-MANIFEST-W3.md §6 W3 测试补强
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import type { WsUser } from '../src/modules/realtime/realtime.gateway';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

vi.mock('../src/shared/cache', () => ({
  redis: {
    rpush: vi.fn().mockResolvedValue(1),
    ltrim: vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
  },
}));

import { redis } from '../src/shared/cache';
import { db } from '../src/shared/db';

const redisMock = redis as unknown as {
  rpush: ReturnType<typeof vi.fn>;
  ltrim: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

const dbOrderMock = db.order.findUnique as unknown as ReturnType<typeof vi.fn>;

function createGateway(): RealtimeGateway {
  const { JwtService } = require('@nestjs/jwt');
  return new RealtimeGateway(new JwtService({}));
}

function createAuthedClient(user: WsUser, initialRooms: string[] = []): any {
  const roomsSet = new Set<string>(initialRooms);
  return {
    id: `client-${Math.random().toString(36).slice(2)}`,
    data: { user },
    join: vi.fn().mockImplementation(async (room: string) => {
      roomsSet.add(room);
    }),
    leave: vi.fn().mockImplementation(async (room: string) => {
      roomsSet.delete(room);
    }),
    emit: vi.fn(),
    get rooms() {
      return roomsSet;
    },
  };
}

describe('RealtimeGateway IM events', () => {
  let gateway: RealtimeGateway;
  let serverEmitMock: ReturnType<typeof vi.fn>;
  let serverToMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    serverEmitMock = vi.fn();
    serverToMock = vi.fn().mockReturnValue({ emit: serverEmitMock });
    (gateway as any).server = { to: serverToMock };
  });

  describe('im:join', () => {
    it('合法 conversationId → client.join + 返回 ok', async () => {
      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cm:c-1:shop-1' },
        client,
      );

      expect(result).toEqual({ ok: true, conversationId: 'conv:cm:c-1:shop-1' });
      expect(client.join).toHaveBeenCalledWith('conv:cm:c-1:shop-1');
    });

    it('非法 conversationId（无 conv: 前缀）→ ok: false', async () => {
      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin({ conversationId: 'foobar' }, client);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // 审查报告 P1 #11：结构化错误码
        expect(result.error.code).toBe('E-IM-001');
      }
      expect(client.join).not.toHaveBeenCalled();
    });

    it('未认证（client.data 无 user）→ ok: false + E-IM-003', async () => {
      const client = createAuthedClient({} as WsUser);
      client.data = {};

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cm:c-1:shop-1' },
        client,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E-IM-003');
      }
    });
  });

  describe('im:send', () => {
    it('合法消息 → 广播 + Redis rpush + incr 未读', async () => {
      // 已 join 该会话（join 时已过 assertParticipant 校验）
      const client = createAuthedClient(
        {
          sub: 'c-1',
          role: 'CUSTOMER',
          deviceType: 'client_app',
        },
        ['conv:cm:c-1:shop-1'],
      );

      const result = await gateway.handleImSend(
        {
          conversationId: 'conv:cm:c-1:shop-1',
          conversationType: 'customer_merchant',
          content: '你好',
        },
        client,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message.content).toBe('你好');
        expect(result.message.senderId).toBe('c-1');
        expect(result.message.conversationType).toBe('customer_merchant');
      }
      expect(serverToMock).toHaveBeenCalledWith('conv:cm:c-1:shop-1');
      expect(serverEmitMock).toHaveBeenCalledWith('im:message', expect.any(Object));
      expect(redisMock.rpush).toHaveBeenCalledWith(
        'im:msg:conv:cm:c-1:shop-1',
        expect.any(String),
      );
      // 对方 shop-1 未读 +1
      expect(redisMock.incr).toHaveBeenCalledWith('im:unread:shop-1:conv:cm:c-1:shop-1');
    });

    it('未先 join → ok: false + E-IM-003（必须先加入会话）', async () => {
      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImSend(
        {
          conversationId: 'conv:cm:c-1:shop-1',
          conversationType: 'customer_merchant',
          content: 'hi',
        },
        client,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E-IM-003');
        expect(result.error.message).toMatch(/join/i);
      }
    });

    it('内容超 2000 字符 → ok: false + E-IM-002', async () => {
      const client = createAuthedClient(
        {
          sub: 'c-1',
          role: 'CUSTOMER',
          deviceType: 'client_app',
        },
        ['conv:cm:c-1:shop-1'],
      );

      const result = await gateway.handleImSend(
        {
          conversationId: 'conv:cm:c-1:shop-1',
          conversationType: 'customer_merchant',
          content: 'x'.repeat(2001),
        },
        client,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E-IM-002');
      }
    });

    it('未认证 → ok: false + E-IM-003', async () => {
      const client = createAuthedClient({} as WsUser);
      client.data = {};

      const result = await gateway.handleImSend(
        {
          conversationId: 'conv:cm:c-1:shop-1',
          conversationType: 'customer_merchant',
          content: 'hi',
        },
        client,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('E-IM-003');
      }
    });
  });

  describe('im:read', () => {
    it('调 Redis del 清零未读 + 返回之前计数', async () => {
      redisMock.get.mockResolvedValue('5');
      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImRead(
        { conversationId: 'conv:cm:c-1:shop-1' },
        client,
      );

      expect(result).toEqual({ ok: true, clearedUnread: 5 });
      expect(redisMock.del).toHaveBeenCalledWith('im:unread:c-1:conv:cm:c-1:shop-1');
    });

    it('无未读 → clearedUnread: 0', async () => {
      redisMock.get.mockResolvedValue(null);
      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImRead(
        { conversationId: 'conv:cm:c-1:shop-1' },
        client,
      );

      expect(result.clearedUnread).toBe(0);
    });
  });

  describe('extractOtherUserId（通过 im:send 副作用间接验证）', () => {
    it('customer_merchant：对方 ID 正确提取', async () => {
      const client = createAuthedClient(
        {
          sub: 'c-1',
          role: 'CUSTOMER',
          deviceType: 'client_app',
        },
        ['conv:cm:c-1:shop-1'],
      );

      await gateway.handleImSend(
        {
          conversationId: 'conv:cm:c-1:shop-1',
          conversationType: 'customer_merchant',
          content: 'hi',
        },
        client,
      );

      expect(redisMock.incr).toHaveBeenCalledWith('im:unread:shop-1:conv:cm:c-1:shop-1');
    });

    it('customer_rider：5 段 conversationId，对方 ID 正确提取', async () => {
      // 假设 customer 已 join 该 customer_rider 会话（join 时校验过 orderId 归属）
      const client = createAuthedClient(
        {
          sub: 'c-1',
          role: 'CUSTOMER',
          deviceType: 'client_app',
        },
        ['conv:cr:c-1:rider-1:order-1'],
      );

      await gateway.handleImSend(
        {
          conversationId: 'conv:cr:c-1:rider-1:order-1',
          conversationType: 'customer_rider',
          content: 'where are you?',
        },
        client,
      );

      expect(redisMock.incr).toHaveBeenCalledWith(
        'im:unread:rider-1:conv:cr:c-1:rider-1:order-1',
      );
    });
  });

  // =========================================================================
  // 参与方鉴权（审查报告 P0 #3 修复 — eavesdropping 防御）
  // =========================================================================
  describe('assertParticipant（eavesdropping 防御）', () => {
    it('customer-A 不能 join customer-B 的 customer_merchant 会话', async () => {
      const clientA = createAuthedClient({
        sub: 'customer-A',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cm:customer-B:shop-X' },
        clientA,
      );

      expect(result.ok).toBe(false);
      expect(clientA.join).not.toHaveBeenCalled();
    });

    it('customer-A 不能 join customer-B 的 customer_service 会话', async () => {
      const clientA = createAuthedClient({
        sub: 'customer-A',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cs:customer-B:cs-1' },
        clientA,
      );

      expect(result.ok).toBe(false);
    });

    it('customer-A 不能 join customer-B 的 customer_rider 会话（即使 orderId 在 conversationId 中）', async () => {
      dbOrderMock.mockResolvedValue({ userId: 'customer-B' }); // 订单属于 B

      const clientA = createAuthedClient({
        sub: 'customer-A',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cr:customer-B:rider-1:order-X' },
        clientA,
      );

      expect(result.ok).toBe(false);
      expect(dbOrderMock).not.toHaveBeenCalled(); // customerId 不匹配直接拒，不查 DB
    });

    it('customer 自己 join 自己的 customer_rider 会话 + 订单归属对 → ok', async () => {
      dbOrderMock.mockResolvedValue({ userId: 'c-1' });

      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cr:c-1:rider-1:order-1' },
        client,
      );

      expect(result.ok).toBe(true);
      expect(dbOrderMock).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        select: { userId: true },
      });
    });

    it('customer_rider：customerId 匹配但订单不属于他 → 拒', async () => {
      dbOrderMock.mockResolvedValue({ userId: 'someone-else' });

      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cr:c-1:rider-1:order-1' },
        client,
      );

      expect(result.ok).toBe(false);
    });

    it('customer_rider：orderId 在 DB 找不到 → 拒', async () => {
      dbOrderMock.mockResolvedValue(null);

      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cr:c-1:rider-1:order-X' },
        client,
      );

      expect(result.ok).toBe(false);
    });

    it('rider 只能 join 自己参与的 customer_rider 会话', async () => {
      const clientRider = createAuthedClient({
        sub: 'rider-1',
        role: 'RIDER',
        deviceType: 'rider_app',
      });

      // rider-1 自己的会话 → ok
      const ok = await gateway.handleImJoin(
        { conversationId: 'conv:cr:c-1:rider-1:order-1' },
        clientRider,
      );
      expect(ok.ok).toBe(true);

      // rider-2 试图 join rider-1 的会话 → 拒
      const clientRider2 = createAuthedClient({
        sub: 'rider-2',
        role: 'RIDER',
        deviceType: 'rider_app',
      });
      const reject = await gateway.handleImJoin(
        { conversationId: 'conv:cr:c-1:rider-1:order-1' },
        clientRider2,
      );
      expect(reject.ok).toBe(false);
    });

    it('super_admin 可 join 任意会话（平台监管）', async () => {
      const client = createAuthedClient({
        sub: 'admin-1',
        role: 'SUPER_ADMIN',
        deviceType: 'admin_web',
      });

      const r1 = await gateway.handleImJoin(
        { conversationId: 'conv:cm:anyone:shop-X' },
        client,
      );
      const r2 = await gateway.handleImJoin(
        { conversationId: 'conv:cs:anyone:cs-X' },
        client,
      );
      const r3 = await gateway.handleImJoin(
        { conversationId: 'conv:cr:anyone:rider-X:order-X' },
        client,
      );

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);
    });

    it('customer_service 可 join 任意会话（介入三方会话）', async () => {
      const client = createAuthedClient({
        sub: 'cs-1',
        role: 'CUSTOMER_SERVICE',
        deviceType: 'admin_web',
      });

      const r = await gateway.handleImJoin(
        { conversationId: 'conv:cm:anyone:shop-X' },
        client,
      );
      expect(r.ok).toBe(true);
    });

    it('customer-A 已 join 自己的会话，不能 send 到 customer-B 的会话', async () => {
      // 即使 A 通过 join 进入自己的会话 conv:cm:A:shopX，仍不能 send 到 B 的 conv:cm:B:shopX
      // 因为 client.rooms.has('conv:cm:B:shopX') === false
      const clientA = createAuthedClient(
        {
          sub: 'customer-A',
          role: 'CUSTOMER',
          deviceType: 'client_app',
        },
        ['conv:cm:customer-A:shop-X'],
      );

      const result = await gateway.handleImSend(
        {
          conversationId: 'conv:cm:customer-B:shop-X',
          conversationType: 'customer_merchant',
          content: 'spy',
        },
        clientA,
      );

      expect(result.ok).toBe(false);
    });

    it('customer_rider 缺 orderId → ok: false', async () => {
      const client = createAuthedClient({
        sub: 'c-1',
        role: 'CUSTOMER',
        deviceType: 'client_app',
      });

      const result = await gateway.handleImJoin(
        { conversationId: 'conv:cr:c-1:rider-1' }, // 缺第 5 段 orderId
        client,
      );

      expect(result.ok).toBe(false);
    });
  });
});
