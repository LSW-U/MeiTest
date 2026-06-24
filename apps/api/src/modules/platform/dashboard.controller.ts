/**
 * Dashboard Controller — 平台数据看板
 *
 * 路径：GET /api/v1/admin/platform/dashboard/summary
 *
 * 权限：仅 super_admin（其他角色 403 由 RolesGuard 兜底）
 *
 * W2 流程 M：W-M-C-T 流程 3 W2 — platform M1 C1
 */
import { Controller, Get, Query, Inject } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { DashboardTimeRange } from '@meimart/api-contract';

@Controller('api/v1/admin/platform/dashboard')
@Roles('super_admin')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('summary')
  async getSummary(
    @Query('range', new ZodValidationPipe(DashboardTimeRange.default('today')))
    range: 'today' | 'week' | 'month',
  ) {
    const data = await this.dashboard.getSummary(range);
    return { success: true as const, data };
  }
}
