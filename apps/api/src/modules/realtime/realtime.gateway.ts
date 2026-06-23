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

/** WS 命名空间：/realtime（与 HTTP 路由 /api/v1 分开，避免冲突） */
const WS_NAMESPACE = '/realtime';

/** 骑手全局 room（所有在线骑手） */
const RIDERS_ROOM = 'riders';

/** 订单 room 前缀（按 orderId 拼接） */
const ORDER_ROOM_PREFIX = 'order:';

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
}
