/**
 * Realtime Module（Socket.IO WS 通道）
 *
 * 决策依据：CLAUDE.md L301（W1 完成判据 - Socket.IO WS 通道打通）
 *
 * 装配：
 *   - RealtimeGateway（@WebSocketGateway 自动注册到 io.of('/realtime') namespace）
 *   - JwtModule（gateway 用 verifyAsync 校验 access token）
 *
 * 多实例广播：W2 接入 @socket.io/redis-adapter（W1 单实例够用）
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    JwtModule.register({
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
