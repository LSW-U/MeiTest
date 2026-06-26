/**
 * IM Module — 流程 M W3（自建 WebSocket 用户签名接口）
 *
 * 范围：
 *   - GET /api/v1/im/signature — 三端 SDK 启动时拉一次，拿 WS 连接元信息
 *   - WS 业务事件（im:join / im:send / im:read）已在 RealtimeGateway 实现（W2 W3 续交付）
 *
 * 决策依据：
 *   - 决策 2026-06-24：IM 自建 WS，复用 Socket.IO RealtimeGateway
 *   - W-M-C-T 流程 3 W3 M1 im C1 "用户签名接口（后端薄壳）"
 */
import { Module } from '@nestjs/common';
import { ImSignatureController } from './im-signature.controller';

@Module({
  controllers: [ImSignatureController],
})
export class ImModule {}
