/**
 * Admin Payment Controller — 后台支付管理（批次 3）
 *
 * 端点（/api/v1/admin/payments）：
 *   GET    /                          列表（游标分页 + join order，filter status/method/orderId/orderNo/mockFlag）
 *   GET    /reconciliation            对账汇总（group by status + method）
 *   GET    /:id                       详情（含 order + order.refunds）
 *   POST   /:orderId/confirm-receipt  确认收款（BANK_TRANSFER 凭证审核 → PAID + Order CONFIRMED，同事务）
 *   POST   /:orderId/mark-failed      标失败（手动，不自动取消订单）
 *
 * 权限：
 *   - 读（list/detail/reconciliation）：SUPER_ADMIN + CUSTOMER_SERVICE
 *   - 写（confirm-receipt/mark-failed）：仅 SUPER_ADMIN
 *
 * 事务编排（confirm-receipt）：
 *   payment.service.ts:262-278 警告 markPaidByAdmin 必须与 orderService.markPaid 同事务，
 *   本 controller 用 withTransaction 包 markPaidByAdminTx + markPaidTx，
 *   事务提交后再调 postMarkPaidEffects（避嵌套事务 + 保持副作用失败容忍）。
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
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { PaymentService, type ListPaymentIntentsParams } from './payment.service';
import { OrderService } from '../order/order.service';
import { type OrderEventContext } from '../order/order.types';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { withTransaction } from '../../shared/db/transaction';
import { db } from '../../shared/db';
import { writeReconciliationLedgerTx } from '../../shared/db/reconciliation-ledger';
import { logger } from '../../shared/logger/logger';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

/** admin 列表查询（mockFlag 走 string → controller 转 boolean，避 z.coerce.boolean 坑） */
const ListPaymentIntentsQuery = z.object({
  status: z
    .enum(['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'])
    .optional(),
  method: z.enum(['COD', 'BANK_TRANSFER', 'WECHAT', 'PAYPAL', 'STRIPE']).optional(),
  orderId: z.string().uuid().optional(),
  orderNo: z.string().optional(),
  mockFlag: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const MarkFailedRequest = z.object({
  reason: z.string().min(1).max(500),
});

@Controller('api/v1/admin/payments')
@Roles('SUPER_ADMIN', 'CUSTOMER_SERVICE')
export class AdminPaymentController {
  constructor(
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  /** 列表（游标分页 + join order 取 orderNo/userId/warehouseId） */
  @Get()
  async list(@Query(new ZodValidationPipe(ListPaymentIntentsQuery)) query: {
    status?: string;
    method?: string;
    orderId?: string;
    orderNo?: string;
    mockFlag?: string;
    cursor?: string;
    limit?: number;
  }) {
    const params: ListPaymentIntentsParams = {
      status: query.status as ListPaymentIntentsParams['status'],
      method: query.method as ListPaymentIntentsParams['method'],
      orderId: query.orderId,
      orderNo: query.orderNo,
      mockFlag:
        query.mockFlag === 'true'
          ? true
          : query.mockFlag === 'false'
            ? false
            : undefined,
      cursor: query.cursor,
      limit: query.limit,
    };
    const result = await this.paymentService.listAllIntents(params);
    return { success: true as const, data: result };
  }

  /** 对账汇总（放 :id 前避路由匹配冲突；@Audit 留痕——金额对账属敏感操作） */
  @Get('reconciliation')
  @Audit({ resource: 'PaymentIntent' })
  async reconciliation() {
    const result = await this.paymentService.getReconciliation();
    return { success: true as const, data: result };
  }

  /** 详情（含 order + order.refunds） */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.paymentService.getAdminDetail(id);
    return { success: true as const, data: result };
  }

  /**
   * 确认收款（admin 审核银行转账凭证 → PaymentIntent PAID + Order CONFIRMED）
   *
   * 同事务编排：withTransaction 包 markPaidByAdminTx + markPaidTx
   * 事务提交后调 postMarkPaidEffects（cancelTimeout / createTask / broadcast / notify，失败容忍）
   */
  @Post(':orderId/confirm-receipt')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'PaymentIntent', resourceIdParam: 'orderId' })
  async confirmReceipt(
    @Param('orderId') orderId: string,
    @Req() req: RequestWithUser,
    @Headers('x-perspective') perspective?: string,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    // 事务外查 order（postMarkPaidEffects 通知用 + P2-1 渠道断言）
    const orderForNotify = await db.order.findUnique({
      where: { id: orderId },
      select: {
        userId: true,
        orderNo: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
      },
    });

    // P2-1 渠道断言（批C 审查 2026-09-08）：本端点仅 BANK_TRANSFER 凭证审核专用。
    // markPaidTx 状态门放行"任意 PENDING_PAYMENT"，不校验渠道——WECHAT/PAYPAL 预付单
    // 误走此端点会静默把台账错标 BANK_TRANSFER（对账分流口径被污染），故在此硬拦。
    if (orderForNotify && orderForNotify.paymentMethod !== 'BANK_TRANSFER') {
      throw new HttpException(
        {
          code: 'E-PAYMENT-012',
          message: `Confirm receipt only available for BANK_TRANSFER, got ${orderForNotify.paymentMethod}`,
        },
        HttpStatus.CONFLICT,
      );
    }

    const eventCtx: OrderEventContext = {
      operatorId: req.user.sub,
      perspective,
      metadata: { source: 'admin_confirm_receipt' },
    };

    // 同事务编排：payment PAID + order CONFIRMED（避 payment.service:262 警告的不一致）
    const intent = await withTransaction(async (tx) => {
      const intentView = await this.paymentService.markPaidByAdminTx(
        tx,
        orderId,
        req.user!.sub,
      );
      await this.orderService.markPaidTx(tx, orderId, eventCtx);
      // 批C 对账分流（微信支付预留 2026-09-08）：BANK_TRANSFER 审核通过 → 同事务写对账台账
      //   - 幂等：orderId @unique + writer 先查后写；失败只 warn 不阻断审核主流程
      //   - 纯 USD 资金流：exchangeRate/amountCny/cashResult 均 null（快照仅人民币线上通道有值）
      //   - P2-1：method 从 order 读取（断言后恒为 BANK_TRANSFER，不硬编码字面量——双保险）
      if (orderForNotify) {
        await writeReconciliationLedgerTx(tx, {
          orderId,
          orderNo: orderForNotify.orderNo,
          paymentMethod: orderForNotify.paymentMethod,
          amountUsd: intentView.amount,
        });
      } else {
        // order 理论不可能缺失（PaymentIntent.orderId FK RESTRICT），真发生则显式留痕不静默
        logger.warn({
          msg: 'RECON_LEDGER_ORDER_MISSING_SKIP',
          orderId,
          note: 'confirm-receipt order not found — ledger row skipped',
        });
      }
      return intentView;
    });

    // 事务后副作用（失败容忍，不阻塞确认流程）
    await this.orderService.postMarkPaidEffects(orderId, eventCtx, orderForNotify);

    return { success: true as const, data: intent };
  }

  /**
   * 标 PaymentIntent FAILED（手动）
   *
   * 不自动取消订单（admin 看到后手动走 admin-order cancel，避免误操作）
   */
  @Post(':orderId/mark-failed')
  @Roles('SUPER_ADMIN')
  @Audit({ resource: 'PaymentIntent', resourceIdParam: 'orderId' })
  async markFailed(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(MarkFailedRequest)) body: { reason: string },
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const intent = await this.paymentService.markFailedByAdmin(
      orderId,
      req.user.sub,
      body.reason,
    );
    return { success: true as const, data: intent };
  }
}
