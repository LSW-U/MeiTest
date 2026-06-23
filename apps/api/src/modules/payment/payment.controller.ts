/**
 * Payment Controller — 客户端支付路由
 *
 * 路由前缀 /api/v1/client/payments（deviceType=client_app）
 *
 * 端点：
 *   GET    /:orderId                       查询 PaymentIntent 状态
 *   POST   /:orderId/mock-callback         dev/staging 模拟支付成功
 *   POST   /:orderId/receipt               银行转账凭证上传（ multipart 由 OSS 中间件处理 URL）
 *   POST   /:orderId/confirm               客户端主动确认（用于轮询查到 PAID 后触发，service 仍以 PAID 为准）
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
  Inject,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { PaymentService, PAYMENT_SERVICE_TOKEN } from './payment.service';
import { OrderService } from '../order/order.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import type { DeviceType } from '@meimart/api-contract';

const UploadReceiptRequest = z.object({
  receiptUrl: z.string().url(),
});
type UploadReceiptRequestType = z.infer<typeof UploadReceiptRequest>;

@Controller('api/v1/client/payments')
@Roles('customer')
export class PaymentController {
  constructor(
    @Inject(PAYMENT_SERVICE_TOKEN) private readonly paymentService: PaymentService,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  /** 查询 PaymentIntent 状态 */
  @Get(':orderId')
  @Audit({ resource: 'PaymentIntent' })
  async getIntent(@Param('orderId') orderId: string) {
    const intent = await this.paymentService.getIntentByOrder(orderId);
    return { success: true as const, data: intent };
  }

  /**
   * dev/staging 模拟第三方支付成功回调
   *
   * 仅 WECHAT/PAYPAL/STRIPE + NODE_ENV !== 'production' 允许
   */
  @Post(':orderId/mock-callback')
  @Audit({ resource: 'PaymentIntent' })
  async mockCallback(@Param('orderId') orderId: string, @Req() req: RequestWithUser) {
    const { orderId: paidOrderId, intentId } = await this.paymentService.mockCallback(orderId);

    // 编排：触发订单状态机 PENDING_PAYMENT → CONFIRMED
    if (paidOrderId) {
      await this.orderService.markPaid(paidOrderId, {
        operatorId: req.user?.sub,
        deviceType: req.user?.deviceType as DeviceType | undefined,
        metadata: { intentId, source: 'mock_callback' },
      });
    }

    return { success: true as const, data: { orderId: paidOrderId, intentId } };
  }

  /**
   * 银行转账凭证上传
   *
   * MVP 假设客户端直接传 OSS 上传后的 URL（OSS 客户端预签名上传由 W 流程 catalog 接入时统一封装）
   */
  @Post(':orderId/receipt')
  @Audit({ resource: 'PaymentIntent' })
  async uploadReceipt(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(UploadReceiptRequest)) body: UploadReceiptRequestType,
  ) {
    const intent = await this.paymentService.uploadReceipt(orderId, body.receiptUrl);
    return { success: true as const, data: intent };
  }

  /**
   * 客户端轮询查到 PAID 后触发确认（仅预付场景）
   *
   * 注意：重复确认幂等（service 已校验）
   */
  @Post(':orderId/confirm')
  @Audit({ resource: 'PaymentIntent' })
  async confirmPaid(@Param('orderId') orderId: string, @Req() req: RequestWithUser) {
    const intent = await this.paymentService.getIntentByOrder(orderId);
    if (intent.status !== 'PAID') {
      throw new HttpException(
        {
          code: 'E-PAYMENT-010',
          message: `Payment not yet paid (current status: ${intent.status})`,
        },
        HttpStatus.CONFLICT,
      );
    }
    await this.orderService.markPaid(orderId, {
      operatorId: req.user?.sub,
      deviceType: req.user?.deviceType as DeviceType | undefined,
      metadata: { intentId: intent.id, source: 'client_confirm' },
    });
    return { success: true as const, data: { orderId, status: 'CONFIRMED' } };
  }
}

interface RequestWithUser {
  user?: RequestUser;
}
