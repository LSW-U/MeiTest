/**
 * Settlement Controller — 结算单查询 + 确认 + 手动触发
 *
 * 路径：
 *   GET  /api/v1/admin/settle/settlements              列表（super_admin）
 *   GET  /api/v1/admin/settle/settlements/:id          详情
 *   POST /api/v1/admin/settle/settlements/:id/confirm  确认（PENDING → CONFIRMED）
 *   POST /api/v1/admin/settle/settlements/run          手动触发（super_admin 调试用）
 */
import { Controller, Get, Post, Param, Body, Query, Inject, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { SettlementService } from './settlement.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  SettlementQuery,
  SettlementRunInput,
  type SettlementQueryType,
  type SettlementRunInputType,
} from '@meimart/api-contract';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

@Controller('api/v1/admin/settle/settlements')
@Roles('super_admin')
export class SettlementController {
  constructor(@Inject(SettlementService) private readonly settle: SettlementService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(SettlementQuery)) query: unknown) {
    const data = await this.settle.list(query as SettlementQueryType);
    return { success: true as const, data };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const data = await this.settle.detail(id);
    return { success: true as const, data };
  }

  /**
   * 确认结算单（PENDING → CONFIRMED）
   *
   * 审查报告 P0 #5：原代码无此接口，settlement 创建后永远 PENDING，
   * 导致 getAvailableBalance 永远 0 余额（只认 CONFIRMED/PAID）。
   */
  @Post(':id/confirm')
  @Audit({ resource: 'Settlement' })
  async confirm(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { user: RequestUser },
  ) {
    const data = await this.settle.confirm(id, req.user.sub);
    return { success: true as const, data };
  }

  /** 手动触发结算（T+1 兜底，正常由 BullMQ 定时任务跑） */
  @Post('run')
  @Audit({ resource: 'Settlement' })
  async run(@Body(new ZodValidationPipe(SettlementRunInput)) body: unknown) {
    const data = await this.settle.runSettlement(body as SettlementRunInputType);
    return { success: true as const, data };
  }
}
