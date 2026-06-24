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
import { AuditLogQuery, type AuditLogQueryType } from '@meimart/api-contract';

@Controller('api/v1/admin/platform/audit-logs')
@Roles('super_admin')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(AuditLogQuery)) query: AuditLogQueryType) {
    const data = await this.audit.list(query);
    return { success: true as const, data };
  }

  @Get('export')
  async exportCsv(
    @Query(new ZodValidationPipe(AuditLogQuery)) query: AuditLogQueryType,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.audit.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    // m1 修复：严格 UUID v4 正则（原正则允许 36 个连字符通过）
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpException(
        { code: 'E-COMMON-001', message: 'Invalid audit log id' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const data = await this.audit.detail(id);
    return { success: true as const, data };
  }
}
