/**
 * Order Controller — 客户端订单路由
 *
 * 路由前缀 /api/v1/client/orders（deviceType=client_app，role=customer）
 *
 * 端点：
 *   POST   /                创建订单（同步事务）
 *   GET    /                列表（按状态筛选 + 游标分页）
 *   GET    /:id             详情（含 items + events）
 *   POST   /:id/cancel      取消订单（用户自助，PENDING_* / CONFIRMED 可取消）
 *
 * 设计：
 *   - 所有端点 @Roles('customer')，全局 APP_GUARD 三道闸门 + DeviceTypeGuard 已检查
 *   - audit 全部走 @Audit 装饰器（AuditInterceptor 读 metadata 写 AuditLog）
 *   - 错误码：E-ORDER-001~005 + E-COMMON-001/002（filter 自动本地化）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Headers,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { CreateOrderRequest, CancelOrderRequest } from '@meimart/api-contract';
import { OrderService } from './order.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { IdempotencyService } from '../../shared/idempotency';
import { db } from '../../shared/db';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type { CreateOrderInput, PaymentMethodValue, OrderStatusValue } from './order.types';

const ListOrdersQuery = z.object({
  status: z
    .enum([
      'PENDING_PAYMENT',
      'PENDING_CONFIRM',
      'CONFIRMED',
      'PICKED',
      'OUT_FOR_DELIVERY',
      'DELIVERED_PAID',
      'DELIVERED_UNPAID',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
    ])
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** M2：Idempotency-Key header UUID 校验，避免客户端传 "1"/"test" 占用表空间 */
const IdempotencyKeyHeader = z.string().uuid().min(1).max(64).optional();

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string | undefined>;
}

@Controller('api/v1/client/orders')
@Roles('customer')
export class OrderController {
  constructor(
    @Inject(OrderService) private readonly orderService: OrderService,
    @Inject(IdempotencyService) private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * 创建订单（同步事务）
   *
   * Idempotency-Key header 防重复下单（客户端生成 UUID，重试用同一个 key）
   * W3 接入：IdempotencyService.withIdempotency 包装 createOrder
   *   - 首次请求 → 执行 createOrder + 缓存 responsePayload
   *   - 同 key 重试 → 直接回放缓存（不再扣库存）
   *   - 并发同 key → 409 IdempotencyConcurrentException
   */
  @Post()
  @Audit({ resource: 'Order' })
  async createOrder(
    @Body(new ZodValidationPipe(CreateOrderRequest)) body: z.infer<typeof CreateOrderRequest>,
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective: string | undefined,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }

    // M2 / V2-S4 修复：严格模式 — 非 UUID 直接 400 拒绝（防失去幂等保护）
    if (rawIdempotencyKey !== undefined) {
      const parsed = IdempotencyKeyHeader.safeParse(rawIdempotencyKey);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'E-COMMON-001',
          message: 'idempotency-key header must be a valid UUID',
        });
      }
    }
    const idempotencyKey = rawIdempotencyKey; // 通过校验，原值传入

    const input: CreateOrderInput = {
      userId: user.sub,
      addressId: body.addressId,
      items: body.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      remark: body.remark,
      paymentMethod: body.paymentMethod as PaymentMethodValue,
      deviceType: user.deviceType,
      perspective,
    };

    const order = await this.idempotencyService.withIdempotency(
      'ORDER_CREATE',
      idempotencyKey,
      () => this.orderService.createOrder(input),
    );
    return { success: true as const, data: order };
  }

  /**
   * 订单列表（游标分页）
   */
  @Get()
  async listOrders(
    @Query(new ZodValidationPipe(ListOrdersQuery)) query: z.infer<typeof ListOrdersQuery>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.orderService.listUserOrders(user.sub, {
      status: query.status as OrderStatusValue | undefined,
      cursor: query.cursor,
      limit: query.limit,
    });
    return {
      success: true as const,
      data: {
        items: result.items,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    };
  }

  /**
   * 订单详情（含 items + events）
   */
  @Get(':id')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async getOrder(@Param('id') id: string, @Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const order = await this.orderService.getOrderDetail(id, user.sub);
    return { success: true as const, data: order };
  }

  /**
   * 配送追踪（HTTP 轮询兜底，WS 断线时前端降级使用）
   *
   * CLAUDE.md §配送追踪双轨：WS 主通道 + HTTP 轮询兜底（30s 间隔）
   *
   * 返回：订单状态 + 骑手信息 + 配送任务状态
   * 位置数据 W5 补（当前 rider_locations 已删，用 Redis rider:online 判断在线）
   */
  @Get(':id/tracking')
  async getTracking(@Param('id') id: string, @Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const order = await this.orderService.getOrderDetail(id, user.sub);

    // 从 delivery_tasks 查配送任务状态
    const task = await db.deliveryTask.findFirst({
      where: { orderId: id },
      select: {
        id: true,
        status: true,
        riderId: true,
        pickedUpAt: true,
        deliveredAt: true,
      },
    });

    return {
      success: true as const,
      data: {
        orderId: order.id,
        orderNo: order.orderNo,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        task: task
          ? {
              taskId: task.id,
              taskStatus: task.status,
              riderId: task.riderId,
              pickedUpAt: task.pickedUpAt,
              deliveredAt: task.deliveredAt,
              // 位置数据 W5 补（当前 rider_locations 已删）
              riderLocation: null,
              estimatedArrival: null,
            }
          : null,
      },
    };
  }

  /**
   * 取消订单
   */
  @Post(':id/cancel')
  @Audit({ resource: 'Order', resourceIdParam: 'id' })
  async cancelOrder(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CancelOrderRequest)) body: z.infer<typeof CancelOrderRequest>,
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective: string | undefined,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    await this.orderService.cancelOrder(id, user.sub, body.reason, {
      operatorId: user.sub,
      deviceType: user.deviceType,
      perspective,
    });
    return { success: true as const, data: { id, status: 'CANCELLED' } };
  }
}
