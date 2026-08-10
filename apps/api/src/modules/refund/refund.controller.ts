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
    'EXPIRED',
    'QUALITY_ISSUE',
    'WRONG_ITEM',
    'SHORTAGE',
    'DELIVERY_TOO_SLOW',
    'CUSTOMER_CHANGE_MIND',
    'OTHER',
  ]),
  reasonDetail: z.string().max(500).optional(),
  /** 部分退款商品列表（不传 = 整单全额退款，向后兼容） */
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        refundQty: z.number().int().min(1),
      }),
    )
    .optional(),
  /** 凭证照片 URL 数组（前端先调 /client/uploads/refund-evidence 拿 URL 再提交；max 9 后端宽松，前端 P13 限 3 张；P13 售后图片 2026-08-10） */
  photos: z.array(z.string().url()).max(9).default([]),
});

const ReviewRefundRequest = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reviewNote: z.string().max(500).optional(),
});

/** admin 退款列表查询（游标分页，批次 2.1） */
const ListRefundsQuery = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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
      items: body.items,
      photos: body.photos,
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
// Admin（super_admin 写 / warehouse_staff + customer_service 只读）
// ============================================================================

@Controller('api/v1/admin/refunds')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE')
export class AdminRefundController {
  constructor(@Inject(RefundService) private readonly refundService: RefundService) {}

  /**
   * 退款列表（游标分页，可按 status 筛选）
   * 返回 { items, nextCursor, hasMore }（批次 2.1 改造，与 admin orders 一致）
   */
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListRefundsQuery))
    query: { status?: string; cursor?: string; limit?: number },
  ) {
    const result = await this.refundService.listAllRefunds({
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 退款详情 */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const refund = await this.refundService.getRefundDetail(id);
    return { success: true as const, data: refund };
  }

  /**
   * 审核退款（仅 super_admin）
   *
   * 权限收紧（对齐 settlement/withdrawal/payment 写操作 SUPER_ADMIN only）：
   *   - refund APPROVE 触发系统实际退款（同 withdraw APPROVE 触发打款），属财务合规范畴
   *   - 原 class 级三角色让 warehouse_staff/customer_service 可单方面放款，
   *     与 withdraw.controller「review2 安全建议」同款漏洞，已方法级收紧
   *   - 列表/详情仍开放三角色只读（运营查进度）
   */
  @Post(':id/review')
  @Roles('SUPER_ADMIN')
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
