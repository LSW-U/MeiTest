/**
 * Realtime Gateway（Socket.IO WebSocket）
 *
 * 决策依据：CLAUDE.md L301（W1 完成判据 - Socket.IO WS 通道打通）+ §配送追踪（双轨）
 *   - 骑手 App WS 推位置 → 服务端 → 客户端 App 实时显示
 *   - HTTP 轮询兜底（WS 断线时降级，由客户端实现）
 *
 * 最小实现（W1）：
 *   1. JWT handshake 鉴权（复用 access token）
 *   2. 骑手加入全局 room "riders"，客户端按 orderId 加入 room "order:{id}"
 *   3. 骑手推 location:update → 广播到对应 order room
 *
 * W2-W5 扩展：
 *   - 接入 @socket.io/redis-adapter（多 api 实例广播）
 *   - 加业务事件：order:status / dispatch:assigned / payment:paid
 *   - 离线消息队列（Redis List 暂存断线期间消息）
 */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import type { Role, DeviceType } from '@meimart/api-contract';
import type { JwtPayload } from '../auth/auth.types';
import { assertJwtSecret } from '../../shared/auth/assert-jwt-secret';
import { logger } from '../../shared/logger/logger';
import { redis } from '../../shared/cache';

/** WS 命名空间：/realtime（与 HTTP 路由 /api/v1 分开，避免冲突） */
const WS_NAMESPACE = '/realtime';

/** 骑手全局 room（所有在线骑手） */
const RIDERS_ROOM = 'riders';

/** 订单 room 前缀（按 orderId 拼接） */
const ORDER_ROOM_PREFIX = 'order:';

/** IM 三方会话类型（决策 2026-06-24 自建 WebSocket） */
export type ConversationType = 'customer_merchant' | 'customer_rider' | 'customer_service';

/** IM 消息（前端发送 + 后端广播） */
export interface ImMessage {
  messageId: string;
  conversationId: string;
  conversationType: ConversationType;
  senderId: string;
  senderRole: Role;
  /** 文本消息 MVP；后续可扩展 image / file / order-card */
  content: string;
  timestamp: number;
}

/** 骑手推送的位置数据 */
export interface RiderLocationUpdate {
  orderId: string;
  lat: number;
  lng: number;
  /** 可选：速度 km/h */
  speed?: number;
  /** 可选：方向（0-360） */
  heading?: number;
  timestamp: number;
}

/** Socket.IO handshake 中的 user（JWT 解码后） */
export interface WsUser {
  sub: string;
  role: Role;
  deviceType: DeviceType;
}

@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly wsLogger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  /**
   * 连接握手：校验 JWT，加入对应 room
   *
   * 客户端连接时必须传 access token：
   *   const socket = io('/realtime', { auth: { token: 'Bearer xxx' } });
   *
   * 加入 room 规则：
   *   - role=rider → 加入 RIDERS_ROOM（骑手全局）
   *   - role=customer / super_admin → 按 client 主动 join 订单 room（见 joinOrder）
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = this.verifyHandshake(client);
      (client.data as { user?: WsUser }).user = user;

      if (user.role === 'rider') {
        await client.join(RIDERS_ROOM);
      }

      logger.info({
        msg: 'ws_connected',
        userId: user.sub,
        role: user.role,
        deviceType: user.deviceType,
        clientId: client.id,
      });
    } catch (e) {
      this.wsLogger.warn(`WS handshake rejected: ${(e as Error).message}`);
      client.emit('error', {
        code: 'E-AUTH-002',
        message: 'Authentication required',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = (client.data as { user?: WsUser }).user;
    if (user) {
      logger.info({
        msg: 'ws_disconnected',
        userId: user.sub,
        clientId: client.id,
      });
    }
  }

  /**
   * 客户端主动加入订单 room（订阅骑手位置）
   *
   * 用法（客户端 App）：
   *   socket.emit('join:order', { orderId: 'xxx' });
   */
  @SubscribeMessage('join:order')
  async handleJoinOrder(
    @MessageBody() data: { orderId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; room: string } | { ok: false; error: string }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return { ok: false, error: 'not authenticated' };
    }
    if (!data?.orderId) {
      return { ok: false, error: 'orderId required' };
    }

    const room = `${ORDER_ROOM_PREFIX}${data.orderId}`;
    await client.join(room);
    logger.info({
      msg: 'ws_join_order',
      userId: user.sub,
      orderId: data.orderId,
      room,
    });
    return { ok: true, room };
  }

  /**
   * 客户端主动离开订单 room
   */
  @SubscribeMessage('leave:order')
  async handleLeaveOrder(
    @MessageBody() data: { orderId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true }> {
    if (data?.orderId) {
      await client.leave(`${ORDER_ROOM_PREFIX}${data.orderId}`);
    }
    return { ok: true };
  }

  /**
   * 骑手推送位置更新（仅 rider 角色可调）
   *
   * 服务端自动广播到对应 order room（客户端订阅后能收到）
   */
  @SubscribeMessage('location:update')
  async handleLocationUpdate(
    @MessageBody() data: RiderLocationUpdate,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; broadcast: true } | { ok: false; error: string }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return { ok: false, error: 'not authenticated' };
    }
    if (user.role !== 'rider') {
      return { ok: false, error: 'only rider can push location' };
    }
    if (!data?.orderId || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
      return { ok: false, error: 'invalid payload (need orderId, lat, lng)' };
    }

    const room = `${ORDER_ROOM_PREFIX}${data.orderId}`;
    // 广播到 order room（订阅该订单的客户端收到）
    this.server.to(room).emit('order:location', {
      orderId: data.orderId,
      lat: data.lat,
      lng: data.lng,
      speed: data.speed,
      heading: data.heading,
      timestamp: data.timestamp ?? Date.now(),
      riderId: user.sub,
    });

    return { ok: true, broadcast: true };
  }

  /**
   * JWT handshake 校验（Socket.IO auth 字段）
   *
   * 客户端传：socket.auth = { token: 'Bearer xxx' } 或 { token: 'xxx' }
   */
  private verifyHandshake(client: Socket): WsUser {
    const auth = client.handshake.auth as { token?: string } | undefined;
    const token = auth?.token;
    if (!token) {
      throw new UnauthorizedException({ code: 'E-AUTH-002', message: 'token missing in auth' });
    }

    // 兼容 "Bearer xxx" 和 "xxx" 两种格式
    const tokenValue = token.startsWith('Bearer ') ? token.slice(7) : token;

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(tokenValue, {
        secret: assertJwtSecret('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'E-AUTH-003', message: 'invalid or expired token' });
    }

    if (!payload.sub || !payload.role || !payload.deviceType) {
      throw new UnauthorizedException({ code: 'E-AUTH-004', message: 'invalid token payload' });
    }

    return {
      sub: payload.sub,
      role: payload.role,
      deviceType: payload.deviceType,
    };
  }

  // ===========================================================================
  // IM 聊天（W3 流程 M — 决策 2026-06-24 自建 WebSocket）
  //
  // 三方会话：
  //   - customer_merchant：客户 ↔ 商家
  //   - customer_rider：客户 ↔ 骑手（按订单维度）
  //   - customer_service：客户 ↔ 客服
  //
  // 会话 ID 规则：{type}:{a}:{b}（a/b 按字典序排，保证双方 ID 一致）
  //   - customer_merchant：conv:cm:{customerId}:{shopId}
  //   - customer_rider：conv:cr:{customerId}:{riderId}:{orderId}
  //   - customer_service：conv:cs:{customerId}:{csId}
  //
  // MVP 阶段：消息只 Redis 暂存（最近 100 条），不入库
  // W6+：迁移腾讯 IM 时再持久化
  // ===========================================================================

  /**
   * 加入 IM 会话 room
   *
   * 客户端用法：
   *   socket.emit('im:join', { conversationId: 'conv:cm:c1:shop1' });
   */
  @SubscribeMessage('im:join')
  async handleImJoin(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return { ok: false, error: 'not authenticated' };
    }
    if (!data?.conversationId?.startsWith('conv:')) {
      return { ok: false, error: 'invalid conversationId (must start with conv:)' };
    }

    await client.join(data.conversationId);
    logger.info({
      msg: 'im_join',
      userId: user.sub,
      conversationId: data.conversationId,
    });

    return { ok: true, conversationId: data.conversationId };
  }

  /**
   * 离开 IM 会话 room
   */
  @SubscribeMessage('im:leave')
  async handleImLeave(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true }> {
    if (data?.conversationId) {
      await client.leave(data.conversationId);
    }
    return { ok: true };
  }

  /**
   * 发送 IM 消息（广播到会话 room + 暂存 Redis）
   *
   * 客户端用法：
   *   socket.emit('im:send', {
   *     conversationId, conversationType, content: '你好'
   *   });
   *   // 接收：socket.on('im:message', (msg) => ...)
   */
  @SubscribeMessage('im:send')
  async handleImSend(
    @MessageBody() data: {
      conversationId: string;
      conversationType: ConversationType;
      content: string;
    },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; message: ImMessage } | { ok: false; error: string }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return { ok: false, error: 'not authenticated' };
    }
    if (!data?.conversationId?.startsWith('conv:')) {
      return { ok: false, error: 'invalid conversationId' };
    }
    if (!data?.content || typeof data.content !== 'string' || data.content.length > 2000) {
      return { ok: false, error: 'content required (string, max 2000 chars)' };
    }

    const message: ImMessage = {
      messageId: `m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      conversationId: data.conversationId,
      conversationType: data.conversationType,
      senderId: user.sub,
      senderRole: user.role,
      content: data.content,
      timestamp: Date.now(),
    };

    // 广播到会话 room（订阅方收到 im:message）
    this.server.to(data.conversationId).emit('im:message', message);

    // Redis 暂存最近 100 条（W3 MVP，不入库）
    const listKey = `im:msg:${data.conversationId}`;
    await redis.rpush(listKey, JSON.stringify(message));
    await redis.ltrim(listKey, -100, -1); // 只保留最近 100 条
    await redis.expire(listKey, 7 * 24 * 3600); // 7 天过期

    // 对方未读数 +1（按 conversationId 解析对方 ID）
    const otherUserId = this.extractOtherUserId(data.conversationId, user.sub);
    if (otherUserId) {
      const unreadKey = `im:unread:${otherUserId}:${data.conversationId}`;
      await redis.incr(unreadKey);
      await redis.expire(unreadKey, 30 * 24 * 3600);
    }

    logger.info({
      msg: 'im_send',
      messageId: message.messageId,
      conversationId: data.conversationId,
      senderId: user.sub,
    });

    return { ok: true, message };
  }

  /**
   * 标记会话已读（清零未读数）
   */
  @SubscribeMessage('im:read')
  async handleImRead(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; clearedUnread: number }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return { ok: true, clearedUnread: 0 };
    }

    const unreadKey = `im:unread:${user.sub}:${data.conversationId}`;
    const prev = await redis.get(unreadKey);
    await redis.del(unreadKey);

    return { ok: true, clearedUnread: prev ? Number(prev) : 0 };
  }

  /**
   * 从 conversationId 提取对方 userId
   *
   * 格式：conv:{type}:{part1}:{part2}[:orderId]
   * 字典序较小的 part 在前，已知自己 ID 取另一个
   */
  private extractOtherUserId(conversationId: string, myUserId: string): string | null {
    const parts = conversationId.split(':');
    // conv:cm:c1:shop1 → ['conv', 'cm', 'c1', 'shop1']
    // conv:cr:c1:r1:o1 → ['conv', 'cr', 'c1', 'r1', 'o1']
    if (parts.length < 4) return null;
    const a = parts[2];
    const b = parts[3];
    if (a === myUserId) return b;
    if (b === myUserId) return a;
    return null;
  }
}
