/**
 * Rider Earnings Controller — 骑手自助收入/流水/提现（批2 B-P1-2）
 *
 * 路径：
 *   GET  /api/v1/rider/earnings/summary        收入汇总（R11 派生口径，4 字段金额分）
 *   GET  /api/v1/rider/earnings/transactions   收入流水（periodDate 倒序 offset 分页）
 *   POST /api/v1/rider/withdrawals             发起提现（body 仅 amount+payoutAccount）
 *   GET  /api/v1/rider/withdrawals             提现记录（仅本人，只读）
 *
 * 落位理由（任务书 4 选一：settle 或 rider 模块）：
 *   选 rider 模块。理由：
 *   1. 路由前缀 /api/v1/rider/* 与 RiderDepositController 等既有骑手端点同前缀，
 *      rider.module 已按前缀组织（settle.module 全部是 /admin/settle/* 前缀）；
 *   2. 依赖方向干净：rider → settle 单向复用 WithdrawalService（settle.module 已
 *      export），不产生循环依赖；反向（settle 依赖 rider）才会成环；
 *   3. admin settle 既有行为零改动（任务书纪律），本次 settle 模块文件零修改。
 *
 * 权限：@Roles('RIDER')（RolesGuard least-privilege，B2 修复先例）；
 *       requesterType/requesterId 由服务端从 JWT 硬编码，不收请求体——防越权。
 * 通知复用：WithdrawalService.review 内部已有 RIDER → User.id 映射通知挂点（批A A4），
 *           rider 侧创建走同一 service 无需重复接线。
 */
import { Controller, Get, Post, Body, Query, Request, Inject } from '@nestjs/common';
import { RiderEarningsService } from './earnings.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import {
  RiderEarningsTransactionsQuery,
  RiderWithdrawalCreateInput,
  RiderWithdrawalQuery,
  type RiderEarningsTransactionsQueryType,
  type RiderWithdrawalCreateInputType,
  type RiderWithdrawalQueryType,
} from '@meimart/api-contract';

@Controller('api/v1/rider')
@Roles('RIDER')
export class RiderEarningsController {
  constructor(@Inject(RiderEarningsService) private readonly earnings: RiderEarningsService) {}

  /** 收入汇总（T+1 口径：today 当日未结算记 0，前端提示"今日收入次日到账"） */
  @Get('earnings/summary')
  async summary(@Request() req: { user: RequestUser }) {
    const data = await this.earnings.getSummary(req.user.sub);
    return { success: true as const, data };
  }

  /** 收入流水（DISPUTED 行前端须标注"争议中，未计入余额"） */
  @Get('earnings/transactions')
  async transactions(
    @Query(new ZodValidationPipe(RiderEarningsTransactionsQuery)) query: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.earnings.getTransactions(
      req.user.sub,
      query as RiderEarningsTransactionsQueryType,
    );
    return { success: true as const, data };
  }

  /** 发起提现（余额不足 E-SETTLE-001；状态机复用 admin 侧，rider 不可改状态） */
  @Post('withdrawals')
  async createWithdrawal(
    @Body(new ZodValidationPipe(RiderWithdrawalCreateInput)) body: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.earnings.createWithdrawal(
      req.user.sub,
      body as RiderWithdrawalCreateInputType,
    );
    return { success: true as const, data };
  }

  /** 提现记录（仅本人，只读） */
  @Get('withdrawals')
  async listWithdrawals(
    @Query(new ZodValidationPipe(RiderWithdrawalQuery)) query: unknown,
    @Request() req: { user: RequestUser },
  ) {
    const data = await this.earnings.listWithdrawals(
      req.user.sub,
      query as RiderWithdrawalQueryType,
    );
    return { success: true as const, data };
  }
}
