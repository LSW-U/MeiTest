/**
 * Withdrawal Controller — 提现申请 + 审核 + 打款标记
 *
 * 路径：
 *   POST /api/v1/admin/settle/withdrawals           商家/骑手创建提现申请
 *   GET  /api/v1/admin/settle/withdrawals           列表
 *   GET  /api/v1/admin/settle/withdrawals/:id       详情
 *   POST /api/v1/admin/settle/withdrawals/:id/review    super_admin 审核（APPROVE/REJECT）
 *   POST /api/v1/admin/settle/withdrawals/:id/mark-paid super_admin 标记线下打款完成
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Request,
  Inject,
} from '@nestjs/common';
import { WithdrawalService } from './withdraw.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import {
  WithdrawalCreateInput,
  WithdrawalQuery,
  WithdrawalReviewInput,
  WithdrawalMarkPaidInput,
  type WithdrawalCreateInputType,
  type WithdrawalQueryType,
  type WithdrawalReviewInputType,
  type WithdrawalMarkPaidInputType,
} from '@meimart/api-contract';

@Controller('api/v1/admin/settle/withdrawals')
export class WithdrawalController {
  constructor(@Inject(WithdrawalService) private readonly withdraw: WithdrawalService) {}

  /**
   * 创建提现申请
   *
   * 权限：商家/骑手自己申请（admin 代申请也走此端点）
   * 角色放宽到 super_admin + warehouse_staff（W2 阶段所有 admin 视角可调，
   * 真实业务接入后改为商家/骑手专用端点 + admin 代申请端点分离）
   */
  @Post()
  @Roles('super_admin', 'warehouse_staff', 'customer_service')
  @Audit({ resource: 'WithdrawalRequest' })
  async create(
    @Body(new ZodValidationPipe(WithdrawalCreateInput)) body: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.withdraw.create(
      body as WithdrawalCreateInputType,
      req.user.sub,
    );
    return { success: true as const, data };
  }

  @Get()
  @Roles('super_admin', 'warehouse_staff', 'customer_service')
  async list(@Query(new ZodValidationPipe(WithdrawalQuery)) query: unknown) {
    const data = await this.withdraw.list(query as WithdrawalQueryType);
    return { success: true as const, data };
  }

  @Get(':id')
  @Roles('super_admin', 'warehouse_staff', 'customer_service')
  async detail(@Param('id') id: string) {
    const data = await this.withdraw.detail(id);
    return { success: true as const, data };
  }

  /** 审核（仅 super_admin） */
  @Post(':id/review')
  @Roles('super_admin')
  @Audit({ resource: 'WithdrawalRequest' })
  async review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WithdrawalReviewInput)) body: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.withdraw.review(
      id,
      body as WithdrawalReviewInputType,
      req.user.sub,
    );
    return { success: true as const, data };
  }

  /** 线下打款完成（仅 super_admin） */
  @Post(':id/mark-paid')
  @Roles('super_admin')
  @Audit({ resource: 'WithdrawalRequest' })
  async markPaid(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(WithdrawalMarkPaidInput)) body: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.withdraw.markPaid(
      id,
      body as WithdrawalMarkPaidInputType,
      req.user.sub,
    );
    return { success: true as const, data };
  }
}
