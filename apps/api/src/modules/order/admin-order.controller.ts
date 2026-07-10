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
  Patch,
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

const AdminUpdateOrderRequest = z.object({
  remark: z.string().max(200).nullable().optional(),
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
   * Admin 确认订单（COD 订单：PENDING_CONFIRM → CONFIRMED）
   *
   * W6 审查报告 P1 修复：COD 订单下单后卡在 PENDING_CONFIRM，
   * 仓库管理员确认后进入配送流程（自动创建 dispatch task）。
   */
  @Post(':id/confirm')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async confirm(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective: string | undefined,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.orderService.adminConfirmOrder(id, {
      operatorId: req.user.sub,
      deviceType: req.user.deviceType as DeviceType,
      perspective,
    });
    const order = await this.orderService.adminGetOrderDetail(id);
    return { success: true as const, data: { id: order.id, status: order.status } };
  }

  /**
   * Admin 拣货完成（CONFIRMED → PICKED）
   *
   * W7 补功能：仓库拣货完成后推进订单状态，骑手可取货出发。
   */
  @Post(':id/pick')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async pick(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective: string | undefined,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.orderService.adminPickOrder(id, {
      operatorId: req.user.sub,
      deviceType: req.user.deviceType as DeviceType,
      perspective,
      metadata: { source: 'admin_pick_endpoint' },
    });

    const order = await this.orderService.adminGetOrderDetail(id);
    return { success: true as const, data: { id: order.id, status: order.status } };
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

    // P1 修复：前置 status 校验（已 CANCELLED → 409，避免 admin 误以为成功）
    if (order.status === 'CANCELLED') {
      throw new HttpException(
        { code: 'E-ORDER-003', message: 'Order already cancelled' },
        HttpStatus.CONFLICT,
      );
    }

    // PAID 订单 → 自动退款（admin 发起 = 商家同意，直接 COMPLETED）
    let refundId: string | undefined;
    if (order.paymentStatus === 'PAID') {
      const refund = await this.refundService.createRefund({
        orderId: id,
        userId: order.userId,
        reason: 'OTHER',
        reasonDetail: `Admin cancelled: ${body.reason}`,
      });
      refundId = refund.id;
      // 接单后状态（CONFIRMED+）refund 是 PENDING，admin 发起 = 直接通过
      if (refund.status === 'PENDING') {
        await this.refundService.reviewRefund(
          refund.id,
          req.user.sub,
          'APPROVE',
          `Auto-approved: admin cancel (${body.reason})`,
        );
      }
    }

    // P1 修复：refund 写入成功后 cancelOrderInternal 失败时记录异常（风险极低，人工介入兜底）
    try {
      await this.orderService.cancelOrderInternal(id, {
        operatorId: req.user.sub,
        deviceType: req.user.deviceType as DeviceType,
        perspective,
        reason: body.reason,
      });
    } catch (err) {
      // refund 已写入但订单取消失败 → 记录异常，需人工介入或脚本修复
      if (refundId) {
        console.error({
          msg: 'ADMIN_CANCEL_REFUND_SUCCESS_ORDER_CANCEL_FAILED',
          orderId: id,
          refundId,
          error: err instanceof Error ? err.message : String(err),
          action: 'Manual intervention required: refund COMPLETED but order not cancelled',
        });
      }
      throw err;
    }
    const cancelled = await this.orderService.adminGetOrderDetail(id);
    return { success: true as const, data: { id: cancelled.id, status: cancelled.status } };
  }

  /**
   * Admin 编辑订单（W7-ext-C）
   *
   * MVP 仅允许改 remark（备注）。warehouseId 改动会破坏 orderNo，deliveryAddress 是快照。
   * 已 CANCELLED / COMPLETED 的订单不可编辑。
   */
  @Patch(':id')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminUpdateOrderRequest)) body: z.infer<typeof AdminUpdateOrderRequest>,
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective: string | undefined,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const order = await this.orderService.adminUpdateOrder(
      id,
      { remark: body.remark },
      {
        operatorId: req.user.sub,
        deviceType: req.user.deviceType as DeviceType,
        perspective,
      },
    );
    return { success: true as const, data: order };
  }
}
