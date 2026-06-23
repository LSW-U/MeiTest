/**
 * Audit Controller — 审计日志查询/详情/导出
 *
 * 路径：
 *   GET /api/v1/admin/platform/audit-logs          列表（游标分页）
 *   GET /api/v1/admin/platform/audit-logs/:id      详情（含 before/after）
 *   GET /api/v1/admin/platform/audit-logs/export   导出 CSV
 *
 * 权限：仅 super_admin
 */
import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from './audit.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { AuditLogQuery } from '@meimart/api-contract';

@Controller('api/v1/admin/platform/audit-logs')
@Roles('super_admin')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(AuditLogQuery)) query: unknown) {
    const data = await this.audit.list(query as Parameters<AuditService['list']>[0]);
    return { success: true as const, data };
  }

  @Get('export')
  async exportCsv(
    @Query(new ZodValidationPipe(AuditLogQuery)) query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.audit.exportCsv(query as Parameters<AuditService['exportCsv']>[0]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpException(
        { code: 'E-COMMON-001', message: 'Invalid audit log id' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const data = await this.audit.detail(id);
    return { success: true as const, data };
  }
}
