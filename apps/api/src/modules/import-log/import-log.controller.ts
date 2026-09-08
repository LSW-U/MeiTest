/**
 * ImportLog Controller（批E D5 v2 2026-09-07：跨批通用导入历史查询）
 *
 * GET /api/v1/admin/import-logs — 分页过滤（resourceType / 操作人 / 时间范围）
 * 权限：SUPER_ADMIN + WAREHOUSE_STAFF（库存导入主力是 WAREHOUSE_STAFF，不能只给 SUPER_ADMIN）
 * 无 POST 写端点（D5 v2 删除前端补记，ImportLog 由导入 service 统一写）
 */
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ListImportLogsQuery } from '@meimart/api-contract';
import { ImportLogService } from './import-log.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';

@Controller('api/v1/admin/import-logs')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class ImportLogController {
  constructor(@Inject(ImportLogService) private readonly importLog: ImportLogService) {}

  /** 导入历史列表（时间/文件名/成功失败数/操作人/失败明细，分页） */
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListImportLogsQuery))
    query: {
      resourceType?: 'Product' | 'Stock';
      operatorId?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const data = await this.importLog.list({
      resourceType: query.resourceType,
      operatorId: query.operatorId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { success: true as const, data };
  }
}
