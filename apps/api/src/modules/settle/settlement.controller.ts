/**
 * Settlement Controller — 结算单查询 + 手动触发
 *
 * 路径：
 *   GET  /api/v1/admin/settle/settlements           列表（super_admin）
 *   GET  /api/v1/admin/settle/settlements/:id       详情
 *   POST /api/v1/admin/settle/settlements/run       手动触发（super_admin 调试用）
 */
import { Controller, Get, Post, Param, Body, Query, Inject } from '@nestjs/common';
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

  /** 手动触发结算（T+1 兜底，正常由 BullMQ 定时任务跑） */
  @Post('run')
  @Audit({ resource: 'Settlement' })
  async run(@Body(new ZodValidationPipe(SettlementRunInput)) body: unknown) {
    const data = await this.settle.runSettlement(body as SettlementRunInputType);
    return { success: true as const, data };
  }
}
