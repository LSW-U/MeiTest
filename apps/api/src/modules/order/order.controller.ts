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
} from '@nestjs/common';
import { z } from 'zod';
import { CreateOrderRequest, CancelOrderRequest } from '@meimart/api-contract';
import { OrderService } from './order.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
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

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string | undefined>;
}

@Controller('api/v1/client/orders')
@Roles('customer')
export class OrderController {
  constructor(@Inject(OrderService) private readonly orderService: OrderService) {}

  /**
   * 创建订单（同步事务）
   *
   * Idempotency-Key header 防重复下单（客户端生成 UUID，重试用同一个 key）
   * W2 阶段 IdempotencyKey 表已建但暂未接入（W3 cart 模块联调时统一接入）
   */
  @Post()
  @Audit({ resource: 'Order' })
  async createOrder(
    @Body(new ZodValidationPipe(CreateOrderRequest)) body: z.infer<typeof CreateOrderRequest>,
    @Req() req: RequestWithUser,
    @Headers('idempotency-key') _idempotencyKey: string | undefined,
    @Headers('x-perspective') perspective: string | undefined,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    void _idempotencyKey; // TODO: W3 cart 联调接入 IdempotencyKey 防重

    const input: CreateOrderInput = {
      userId: user.sub,
      addressId: body.addressId,
      items: body.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      remark: body.remark,
      paymentMethod: body.paymentMethod as PaymentMethodValue,
      deviceType: user.deviceType,
      perspective,
    };

    const order = await this.orderService.createOrder(input);
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
