/**
 * Rider Location Controller — 骑手位置上报 HTTP 通道（后台定位兜底）
 *
 * 路由前缀 /api/v1/rider/location（deviceType=rider_app，role=RIDER）
 *
 * 端点：
 *   POST /report  骑手上报位置 → 转发为 order:location WS 广播
 *
 * 决策依据：P0 后台定位（CLAUDE.md 规则 16）
 *   - 前台定位走 WS location:update（useLocation.ts，iOS 前台 socket 可靠）
 *   - 后台定位走 HTTP /report（useBackgroundTask.ts，iOS 后台 socket 会被系统挂起 ~30s）
 *   - 后端复用 RealtimeGateway 广播，与 WS 通道合一（订阅 order:{orderId} room 的客户端无感知）
 *
 * 校验链（与 realtime.gateway handleLocationUpdate 一致，复用 assertRiderOwnsOrder）：
 *   role=RIDER → payload（orderId 强校验，契约里 optional 是 WS 兜底用）→ assertRiderOwnsOrder → 广播
 */
import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { ReportLocationRequest } from '@meimart/api-contract';
import { RealtimeGateway, ORDER_ROOM_PREFIX } from '../realtime/realtime.gateway';
import { assertRiderOwnsOrder } from '../realtime/rider-order-guard';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/rider/location')
@Roles('RIDER')
export class RiderLocationController {
  constructor(
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * 骑手上报位置（后台定位 HTTP 通道，转发为 order:location WS 广播）。
   *
   * 设计要点：
   * - HTTP 短请求，iOS 后台能完成（长连接 socket.io 在 iOS 后台会被挂起）
   * - orderId 强校验必填：后台定位仅在「配送中」启用，必带 orderId
   * - 复用 WS 广播：订阅 order:{orderId} room 的客户端（客户 App P11 物流追踪）无感知
   */
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportLocationRequest))
    body: z.infer<typeof ReportLocationRequest>,
    @Req() req: RequestWithUser,
  ): Promise<{ success: true; data: { broadcast: true } }> {
    const user = req.user;
    if (!user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    // HTTP report 强校验 orderId（契约里 optional 是 WS 兜底单点上报用的）
    if (!body.orderId) {
      throw new HttpException(
        { code: 'E-RIDER-007', message: 'orderId required for background location report' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 骑手-订单归属校验（与 WS handler 复用同一 helper，P1-9 修复）
    const ownership = await assertRiderOwnsOrder(body.orderId, user.sub);
    if (!ownership.ok) {
      if (ownership.reason === 'not_found') {
        throw new HttpException(
          { code: 'E-ORDER-001', message: 'order not found' },
          HttpStatus.NOT_FOUND,
        );
      }
      throw new HttpException(
        { code: 'E-DISPATCH-003', message: 'order not assigned to this rider' },
        HttpStatus.FORBIDDEN,
      );
    }

    // 复用 WS 广播（与 realtime.gateway handleLocationUpdate 合一）
    const room = `${ORDER_ROOM_PREFIX}${body.orderId}`;
    this.realtime.server.to(room).emit('order:location', {
      orderId: body.orderId,
      lat: body.lat,
      lng: body.lng,
      speed: body.speed,
      heading: body.heading,
      timestamp: Date.now(),
      riderId: user.sub,
    });

    return { success: true as const, data: { broadcast: true } };
  }
}
