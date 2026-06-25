/**
 * IM Signature Controller — 自建 WebSocket 用户签名接口
 *
 * 路径：GET /api/v1/im/signature
 *
 * 决策依据：
 * - 决策 2026-06-24：IM 不接腾讯 IM/融云，自建 WS（复用 RealtimeGateway）
 * - 原 W-M-C-T 任务 "用户签名接口（后端薄壳）" 在自建 WS 场景下的等价实现：
 *   返回 WS 连接元信息（URL / namespace / 事件名 / 会话 ID 模板）给三端 SDK
 *   （客户端已有 access token，本接口不返回 token，只补连接配置）
 *
 * 鉴权：任何登录用户（customer / rider / super_admin / customer_service）
 *   - WS 网关在 handshake 阶段二次校验 JWT，本接口仅返回元信息不暴露 secret
 */
import { Controller, Get, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type { ImSignatureType } from '@meimart/api-contract';

/** 服务端事件名（客户端订阅） */
const SERVER_EVENTS = ['im:message'] as const;

/** 客户端事件名（客户端发送） */
const CLIENT_EVENTS = ['im:join', 'im:leave', 'im:send', 'im:read'] as const;

/** Redis 暂存窗口（与 RealtimeGateway 一致：7 天） */
const MESSAGE_RETENTION_DAYS = 7;

@Controller('api/v1/im')
@Roles('customer', 'rider', 'super_admin', 'customer_service')
export class ImSignatureController {
  @Get('signature')
  signature(@Request() req: ExpressRequest & { user: RequestUser }): {
    success: true;
    data: ImSignatureType;
  } {
    const user = req.user;
    const wsUrl = this.resolveWsUrl(req);

    return {
      success: true,
      data: {
        url: wsUrl,
        namespace: '/realtime',
        transport: 'websocket',
        authScheme: 'bearer',
        userId: user.sub,
        // 路由 @Roles 已限制为 customer/rider/super_admin/customer_service，warehouse_staff 不接入 IM
        role: user.role as 'customer' | 'rider' | 'super_admin' | 'customer_service',
        serverEvents: [...SERVER_EVENTS],
        clientEvents: [...CLIENT_EVENTS],
        conversationFormats: {
          customerMerchant: {
            template: 'conv:cm:{customerId}:{shopId}',
            placeholders: ['customerId', 'shopId'],
          },
          customerRider: {
            template: 'conv:cr:{customerId}:{riderId}:{orderId}',
            placeholders: ['customerId', 'riderId', 'orderId'],
          },
          customerService: {
            template: 'conv:cs:{customerId}:{csId}',
            placeholders: ['customerId', 'csId'],
          },
        },
        serverTime: new Date().toISOString(),
        messageRetentionDays: MESSAGE_RETENTION_DAYS,
      },
    };
  }

  /**
   * 解析 WS URL：
   *   1. 优先 WS_URL 环境变量（生产/部署场景显式配置）
   *   2. 退化为根据 HTTP 请求 host 推断（http→ws / https→wss）
   *   3. dev 兜底 ws://localhost:3001（独立端口，避免与 API 3000 冲突）
   */
  private resolveWsUrl(req: ExpressRequest): string {
    const fromEnv = process.env.WS_URL?.trim();
    if (fromEnv) return fromEnv;

    const host = req.get('host');
    if (host) {
      const proto = req.protocol === 'https' ? 'wss' : 'ws';
      return `${proto}://${host}`;
    }
    return 'ws://localhost:3001';
  }
}
