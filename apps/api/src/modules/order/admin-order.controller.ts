/**
 * Admin Order Controller — 后台订单管理路由
 *
 * 路由前缀 /api/v1/admin/orders（deviceType=admin_web，role=super_admin/warehouse_staff/customer_service）
 *
 * 端点：
 *   GET    /                列表（按 status/userId/warehouseId/orderNo 筛选 + 游标分页）
 *   GET    /:id             详情（含 items + events，不校验 userId 归属）
 *   POST   /:id/cancel      admin 取消订单（PAID 订单自动触发 refund）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { OrderService } from './order.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type { DeviceType } from '@meimart/api-contract';
import type { OrderStatusValue } from './order.types';

import { RefundService } from '../refund/refund.service';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

const ListOrdersQuery = z.object({
  status: z
    .enum([
      'PENDING_PAYMENT',
      'PENDING_CONFIRM',
      'CONFIRMED',
      'PICKED',
      'OUT_FOR_DELIVERY',
      'DELIVERED_PAID',
      'DELIVERED',
      'DELIVERED_UNPAID',
      'COMPLETED',
      'CANCELLED',
    ])
    .optional(),
  userId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  orderNo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const AdminCancelOrderRequest = z.object({
  reason: z.string().min(1).max(200),
});

@Controller('api/v1/admin/orders')
@Roles('super_admin', 'warehouse_staff', 'customer_service')
export class AdminOrderController {
  constructor(
    @Inject(OrderService) private readonly orderService: OrderService,
    @Inject(RefundService) private readonly refundService: RefundService,
  ) {}

  /** 列表（按 status/userId/warehouseId/orderNo 筛选 + 游标分页） */
  @Get()
  async list(@Query(new ZodValidationPipe(ListOrdersQuery)) query: z.infer<typeof ListOrdersQuery>) {
    const result = await this.orderService.listAllOrders({
      status: query.status as OrderStatusValue | undefined,
      userId: query.userId,
      warehouseId: query.warehouseId,
      orderNo: query.orderNo,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 详情（含 items + events） */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const order = await this.orderService.adminGetOrderDetail(id);
    return { success: true as const, data: order };
  }

  /**
   * admin 取消订单
   *
   * W5 升级（W4 P0-2 → W5）：
   * - paymentStatus=UNPAID → 直接取消
   * - paymentStatus=PAID → 自动创建 Refund(COMPLETED，admin 发起 = 商家同意) + 取消订单
   */
  @Post(':id/cancel')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminCancelOrderRequest)) body: { reason: string },
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective: string | undefined,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const order = await this.orderService.adminGetOrderDetail(id);

    // PAID 订单 → 自动退款（admin 发起 = 商家同意，直接 COMPLETED）
    if (order.paymentStatus === 'PAID') {
      const refund = await this.refundService.createRefund({
        orderId: id,
        userId: order.userId,
        reason: 'OTHER',
        reasonDetail: `Admin cancelled: ${body.reason}`,
      });
      // 接单后状态（CONFIRMED+）refund 是 PENDING，admin 发起 = 直接通过
      if (refund.status === 'PENDING') {
        await this.refundService.reviewRefund(refund.id, req.user.sub, 'APPROVE', `Auto-approved: admin cancel`);
      }
    }

    await this.orderService.cancelOrderInternal(id, {
      operatorId: req.user.sub,
      deviceType: req.user.deviceType as DeviceType,
      perspective,
      reason: body.reason,
    });
    const cancelled = await this.orderService.adminGetOrderDetail(id);
    return { success: true as const, data: { id: cancelled.id, status: cancelled.status } };
  }
}
