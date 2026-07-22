/**
 * Withdrawal Controller — 提现申请 + 审核 + 打款标记
 *
 * 路径：
 *   POST /api/v1/admin/settle/withdrawals           创建提现申请（super_admin 代录）
 *   GET  /api/v1/admin/settle/withdrawals           列表
 *   GET  /api/v1/admin/settle/withdrawals/:id       详情
 *   POST /api/v1/admin/settle/withdrawals/:id/review    super_admin 审核（APPROVE/REJECT）
 *   POST /api/v1/admin/settle/withdrawals/:id/mark-paid super_admin 标记线下打款完成
 *
 * 权限模型（review2-fix-1 修复）：
 *   - 所有写操作限 super_admin（MVP 单一商家 = 平台自营，admin 代录是唯一路径）
 *   - 列表/详情允许 warehouse_staff/customer_service 只读（运营查进度）
 *   - W6 多商家开放后拆分：
 *     · /client/withdrawals — customer/rider 自申请，强制 requesterId = req.user.sub
 *     · /admin/withdrawals/on-behalf-of — 代录专用，写审计时区分 onBehalfOf
 *   - review2 安全建议：原 @Roles('SUPER_ADMIN','WAREHOUSE_STAFF','CUSTOMER_SERVICE') 写操作
 *     让 warehouse_staff/customer_service 可代任意 shopId/riderId 发起提现，已收紧
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
   * 创建提现申请（super_admin 代录）
   *
   * 业务：MVP 单一商家场景下，所有提现由平台运营代为录入
   * 审计：service 写 WITHDRAWAL_CREATED 日志含 userId（执行代录的 admin）
   */
  @Post()
  @Roles('SUPER_ADMIN')
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
  @Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE')
  async list(@Query(new ZodValidationPipe(WithdrawalQuery)) query: unknown) {
    const data = await this.withdraw.list(query as WithdrawalQueryType);
    return { success: true as const, data };
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE')
  async detail(@Param('id') id: string) {
    const data = await this.withdraw.detail(id);
    return { success: true as const, data };
  }

  /** 审核（仅 super_admin） */
  @Post(':id/review')
  @Roles('SUPER_ADMIN')
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
  @Roles('SUPER_ADMIN')
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
