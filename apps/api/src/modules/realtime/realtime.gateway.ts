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
import { db } from '../../shared/db';

/** WS 命名空间：/realtime（与 HTTP 路由 /api/v1 分开，避免冲突） */
const WS_NAMESPACE = '/realtime';

/** 骑手全局 room（所有在线骑手） */
const RIDERS_ROOM = 'riders';
/** 客服/管理员 room：dispatch.reportIssue 推送 dispatch:issue-reported 事件 */
const CUSTOMER_SERVICE_ROOM = 'customer-service';

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

/** IM 错误（结构化，前端按 code 查 i18n） */
export interface ImError {
  /** E-IM-001/002/003，对齐 packages/api-contract/src/schemas/im.ts 注释 */
  code: 'E-IM-001' | 'E-IM-002' | 'E-IM-003';
  message: string;
}

/** 构造结构化 IM 错误（审查报告 P1 #11 — 对齐契约） */
function imError(code: ImError['code'], message: string): { ok: false; error: ImError } {
  return { ok: false, error: { code, message } };
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
      // 审查报告 P0-2 修复：customer_service + super_admin 自动加入 customer-service room
      // dispatch.reportIssue 推 'dispatch:issue-reported' 到这个 room，否则客服收不到 WS 推送
      if (user.role === 'customer_service' || user.role === 'super_admin') {
        await client.join(CUSTOMER_SERVICE_ROOM);
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

  // ==========================================================================
  // W4：业务事件广播 helper（service 层调用，广播到订阅了对应 room 的客户端）
  // ==========================================================================

  /**
   * 订单状态变更（broadcast 到 order room）
   *
   * 触发点（W5 串接）：
   *   - OrderService.markPaid（PENDING_PAYMENT → CONFIRMED）
   *   - OrderService.cancelOrder（任何状态 → CANCELLED）
   *   - DispatchService.acceptTask（CONFIRMED → PICKED）
   *   - DispatchService.deliverTask（OUT_FOR_DELIVERY → DELIVERED_*）
   *
   * 客户端订阅：socket.emit('join:order', { orderId }) 后自动收到
   */
  broadcastOrderStatusChange(
    orderId: string,
    payload: {
      fromStatus: string;
      toStatus: string;
      operatorId?: string;
      reason?: string;
      timestamp?: string;
    },
  ): void {
    if (!this.server) return;
    const room = `${ORDER_ROOM_PREFIX}${orderId}`;
    this.server.to(room).emit('order:status-changed', {
      orderId,
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
    this.wsLogger.debug({
      msg: 'ws_order_status_changed',
      orderId,
      from: payload.fromStatus,
      to: payload.toStatus,
      room,
    });
  }

  /**
   * 配送任务被接单（broadcast 到 riders room + order room）
   *
   * 客户端订阅：
   *   - 所有 rider 自动在 riders room，收到该事件表示有新单可抢
   *   - 订单的 customer/merchant 在 order room，收到该事件表示订单已派单
   */
  broadcastDeliveryAssigned(payload: {
    orderId: string;
    taskId: string;
    riderId: string;
    riderName?: string;
    warehouseId: string;
  }): void {
    if (!this.server) return;
    const room = `${ORDER_ROOM_PREFIX}${payload.orderId}`;
    // 客户/商家：收到骑手已接单
    this.server.to(room).emit('delivery:assigned', payload);
    // 所有 rider：从抢单池移除该任务（避免重复抢单）
    this.server.to(RIDERS_ROOM).emit('dispatch:task-removed', { taskId: payload.taskId });
  }

  /**
   * 库存告警（broadcast 到 warehouse room）
   *
   * 触发点：库存低于安全阈值（10），warehouse_staff 应收到通知补货
   */
  broadcastInventoryAlert(payload: {
    warehouseId: string;
    skuId: string;
    currentQty: number;
    threshold: number;
  }): void {
    if (!this.server) return;
    const room = `warehouse:${payload.warehouseId}`;
    this.server.to(room).emit('inventory:low-stock', payload);
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

    // P1-9 修复：骑手-订单绑定校验（防骑手 A 给骑手 B 的订单推伪造位置）
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      select: { riderId: true },
    });
    if (!order) {
      return { ok: false, error: 'order not found' };
    }
    // riderId 可能为 null（订单未派单），但已派单时必须本人
    if (order.riderId && order.riderId !== user.sub) {
      this.wsLogger.warn({
        msg: 'ws_location_forbidden_rider_mismatch',
        userId: user.sub,
        orderId: data.orderId,
        assignedRiderId: order.riderId,
      });
      return { ok: false, error: 'order not assigned to this rider' };
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
   *
   * 鉴权（审查报告 P0 #3 修复）：
   *   - super_admin：允许任意会话（平台监管）
   *   - customer_service：允许 customer_service 类会话（cs:*）+ 可代回任意会话
   *   - customer：必须是 conversationId 中的 customerId
   *   - rider：必须是 customer_rider 会话中的 riderId
   *   - customer_rider 会话：额外校验 orderId 属于 customerId（DB 查 Order）
   */
  @SubscribeMessage('im:join')
  async handleImJoin(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; conversationId: string } | { ok: false; error: ImError }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return imError('E-IM-003', 'not authenticated');
    }
    if (!data?.conversationId?.startsWith('conv:')) {
      return imError('E-IM-001', 'invalid conversationId (must start with conv:)');
    }

    const auth = await this.assertParticipant(data.conversationId, user);
    if (!auth.ok) {
      logger.warn({
        msg: 'im_join_forbidden',
        userId: user.sub,
        role: user.role,
        conversationId: data.conversationId,
        reason: auth.error,
      });
      // 鉴权失败不暴露内部原因（防止信息泄露），统一返回 E-IM-003
      return imError('E-IM-003', 'forbidden: not a participant');
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
  ): Promise<{ ok: true; message: ImMessage } | { ok: false; error: ImError }> {
    const user = (client.data as { user?: WsUser }).user;
    if (!user) {
      return imError('E-IM-003', 'not authenticated');
    }
    if (!data?.conversationId?.startsWith('conv:')) {
      return imError('E-IM-001', 'invalid conversationId');
    }
    if (!data?.content || typeof data.content !== 'string' || data.content.length > 2000) {
      return imError('E-IM-002', 'content required (string, max 2000 chars)');
    }

    // 审查报告 P0 #3 修复：必须先 join 才能 send
    // （join 时已过 assertParticipant 校验，包括 customer_rider 的 orderId 归属）
    if (!client.rooms.has(data.conversationId)) {
      logger.warn({
        msg: 'im_send_not_joined',
        userId: user.sub,
        role: user.role,
        conversationId: data.conversationId,
      });
      return imError('E-IM-003', 'must join conversation before sending');
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

  /**
   * 校验 user 是否为会话参与方（审查报告 P0 #3）
   *
   * 规则：
   *   - super_admin：允许任意（平台监管）
   *   - customer_service：允许任意（客服可介入三方会话）
   *   - customer：必须是 conversationId 中的 customerId（parts[2]）
   *   - rider：必须是 customer_rider 会话中的 riderId（parts[3]）
   *   - customer_rider 会话：额外校验 orderId 属于 customerId（DB 查 Order.userId）
   *
   * @returns ok=true 通过；ok=false + error 描述拒绝原因
   */
  private async assertParticipant(
    conversationId: string,
    user: WsUser,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const parts = conversationId.split(':');
    // conv:cm:c1:shop1 → ['conv', 'cm', 'c1', 'shop1']，最小 4 段
    if (parts.length < 4) {
      return { ok: false, error: 'invalid conversationId format' };
    }
    const [, convType, customerId, partyB] = parts;
    const orderId = parts.length >= 5 ? parts[4] : null;

    // 平台与客服角色允许任意会话
    if (user.role === 'super_admin' || user.role === 'customer_service') {
      return { ok: true };
    }

    if (convType === 'cm') {
      // customer ↔ merchant：customer 必须是 customerId
      //
      // TODO(W6+ 多商家开放)：
      //   - 当前 MVP 单一商家（平台自营），"商家方"由 super_admin / customer_service 代理
      //   - 多商家开放后，需要：
      //     · 扩 Role 加 'merchant_staff'
      //     · 新增 verifyShopMembership(shopId, user.sub) 校验 staff 属于该 shop
      //     · 此分支改为：
      //         if (user.role === 'customer' && user.sub === customerId) return ok;
      //         if (user.role === 'merchant_staff' && await verifyShopMembership(partyB, user.sub)) return ok;
      //   - 同时 customer_service 是否真需要介入 cm（当前是放过的）需要业务确认
      if (user.role === 'customer' && user.sub === customerId) {
        return { ok: true };
      }
      return { ok: false, error: 'not a participant of this customer_merchant conversation' };
    }

    if (convType === 'cs') {
      // customer ↔ customer_service：customer 必须是 customerId；客服角色已放过
      if (user.role === 'customer' && user.sub === customerId) {
        return { ok: true };
      }
      return { ok: false, error: 'not a participant of this customer_service conversation' };
    }

    if (convType === 'cr') {
      // customer ↔ rider：customer 必须是 customerId AND rider 必须是 partyB AND orderId 属于 customerId
      if (!orderId) {
        return { ok: false, error: 'customer_rider conversation requires orderId' };
      }
      if (user.role === 'customer' && user.sub === customerId) {
        // 校验订单归属
        const belongs = await this.verifyOrderOwnership(orderId, customerId);
        if (!belongs) {
          return { ok: false, error: 'order does not belong to customer' };
        }
        return { ok: true };
      }
      if (user.role === 'rider' && user.sub === partyB) {
        // rider 不强校验订单归属（已通过派单系统获得该订单）
        return { ok: true };
      }
      return { ok: false, error: 'not a participant of this customer_rider conversation' };
    }

    return { ok: false, error: `unknown conversation type: ${convType}` };
  }

  /**
   * 校验订单归属（customer_rider 会话用）
   * C 流程订单/支付完成后此项真实有效；MVP 早期 Order 表为空时返回 false
   */
  private async verifyOrderOwnership(orderId: string, customerId: string): Promise<boolean> {
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { userId: true },
      });
      return order?.userId === customerId;
    } catch (err) {
      logger.error({
        msg: 'im_order_verify_failed',
        orderId,
        customerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}
