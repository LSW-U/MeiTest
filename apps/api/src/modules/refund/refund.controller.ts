/**
 * Refund Controller — 退款路由（W5 流程 C）
 *
 * 客户端端点（/api/v1/client/refunds）：
 *   POST   /                申请退款
 *   GET    /                我的退款列表
 *   GET    /:id             退款详情
 *   POST   /:id/cancel      撤回退款申请
 *
 * Admin 端点（/api/v1/admin/refunds）：
 *   GET    /                退款列表（可按 status 筛选）
 *   GET    /:id             退款详情
 *   POST   /:id/review      审核退款（APPROVE / REJECT）
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { RefundService } from './refund.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

const CreateRefundRequest = z.object({
  orderId: z.string().uuid(),
  reason: z.enum([
    'OUT_OF_STOCK',
    'QUALITY_ISSUE',
    'WRONG_ITEM',
    'DELIVERY_TOO_SLOW',
    'CUSTOMER_CHANGE_MIND',
    'OTHER',
  ]),
  reasonDetail: z.string().max(500).optional(),
});

const ReviewRefundRequest = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reviewNote: z.string().max(500).optional(),
});

// ============================================================================
// 客户端（customer 视角）
// ============================================================================

@Controller('api/v1/client/refunds')
@Roles('CUSTOMER')
export class ClientRefundController {
  constructor(@Inject(RefundService) private readonly refundService: RefundService) {}

  /** 申请退款 */
  @Post()
  @Audit({ resource: 'Refund' })
  async create(
    @Body(new ZodValidationPipe(CreateRefundRequest)) body: z.infer<typeof CreateRefundRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const refund = await this.refundService.createRefund({
      orderId: body.orderId,
      userId: req.user.sub,
      reason: body.reason,
      reasonDetail: body.reasonDetail,
    });
    return { success: true as const, data: refund };
  }

  /** 我的退款列表 */
  @Get()
  async list(@Req() req: RequestWithUser) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const refunds = await this.refundService.listUserRefunds(req.user.sub);
    return { success: true as const, data: refunds };
  }

  /** 退款详情 */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const refund = await this.refundService.getRefundDetail(id);
    return { success: true as const, data: refund };
  }

  /** 撤回退款申请 */
  @Post(':id/cancel')
  @Audit({ resource: 'Refund', resourceIdParam: 'id' })
  async cancel(@Param('id') id: string, @Req() req: RequestWithUser) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const refund = await this.refundService.cancelRefund(id, req.user.sub);
    return { success: true as const, data: refund };
  }
}

// ============================================================================
// Admin（super_admin / warehouse_staff 视角）
// ============================================================================

@Controller('api/v1/admin/refunds')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE')
export class AdminRefundController {
  constructor(@Inject(RefundService) private readonly refundService: RefundService) {}

  /** 退款列表 */
  @Get()
  async list(@Query('status') status?: string) {
    const refunds = await this.refundService.listAllRefunds(status);
    return { success: true as const, data: refunds };
  }

  /** 退款详情 */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const refund = await this.refundService.getRefundDetail(id);
    return { success: true as const, data: refund };
  }

  /** 审核退款 */
  @Post(':id/review')
  @Audit({ resource: 'Refund', resourceIdParam: 'id' })
  async review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewRefundRequest)) body: z.infer<typeof ReviewRefundRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const refund = await this.refundService.reviewRefund(
      id,
      req.user.sub,
      body.action,
      body.reviewNote,
    );
    return { success: true as const, data: refund };
  }
}
