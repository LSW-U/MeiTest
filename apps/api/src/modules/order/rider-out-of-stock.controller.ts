/**
 * Rider Out-of-Stock Controller — 骑手兜底缺货登记（缺货履约闭环批1 2026-10-24）
 *
 * 路由：POST /api/v1/rider/orders/:id/out-of-stock
 * 窗口：订单 OUT_FOR_DELIVERY（任务 DELIVERING）；仅部分缺（D12），全缺请求拒 E-OOS-004。
 * 鉴权：@Roles('RIDER') 类级（order-history.controller.ts 先例）+ deviceType guard 由
 *       /api/v1/rider 前缀自动覆盖（device-type.guard.ts ROUTE_DEVICE_MAP）。
 */
import { Controller, Post, Param, ParseUUIDPipe, Body, Req, Inject, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { OutOfStockService, OUT_OF_STOCK_REASONS } from './out-of-stock.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

/** 骑手部分缺登记请求（简化版：数量 + 原因 + 可选备注/取证/替代建议） */
const RiderOutOfStockRequest = z.object({
  outOfStockQty: z.coerce.number().int().positive().max(9999),
  reason: z.enum(OUT_OF_STOCK_REASONS),
  note: z.string().max(200).optional(),
  evidenceUrls: z.array(z.string().url()).max(3).optional(),
  suggestionItemId: z.string().uuid().optional(),
});

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/rider/orders')
@Roles('RIDER')
export class RiderOutOfStockController {
  constructor(@Inject(OutOfStockService) private readonly outOfStockService: OutOfStockService) {}

  /** 骑手兜底部分缺登记（DELIVERING 窗口；全缺拒 E-OOS-004，D12） */
  @Post(':id/out-of-stock')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async reportOutOfStock(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RiderOutOfStockRequest)) body: z.infer<typeof RiderOutOfStockRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException({
        code: 'E-AUTH-002',
        message: 'auth required',
      });
    }
    const result = await this.outOfStockService.riderReportOutOfStock(id, {
      riderUserId: user.sub,
      outOfStockQty: body.outOfStockQty,
      reason: body.reason,
      note: body.note ?? null,
      evidenceUrls: body.evidenceUrls,
      suggestionItemId: body.suggestionItemId ?? null,
    });
    return { success: true as const, data: result };
  }
}
