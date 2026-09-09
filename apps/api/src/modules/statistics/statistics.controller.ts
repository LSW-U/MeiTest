/**
 * Statistics Controller（数据分析报表）
 *
 * 路径：
 *   GET /api/v1/admin/statistics/products/top     商品销量排行（R9）
 *   GET /api/v1/admin/statistics/products/export  商品排行导出 CSV（lang 显式传）
 *
 * 权限：仅 SUPER_ADMIN（对齐 platform/dashboard.controller 现行实现）
 * 时间范围：range 预设三值 或 from/to 自定义——校验由批A 公共层 buildRange 抛
 *          E-STATISTICS-001/002（AllExceptionsFilter 按 Accept-Language 查 errors.json）
 *
 * 来源：数据分析报表模块 批B（2026-09-10）
 */
import { Controller, Get, Query, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { StatisticsService } from './statistics.service';
import { StatisticsCsvService } from './statistics-csv.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  StatisticsTopProductsQuery,
  StatisticsExportQuery,
} from '@meimart/api-contract';

@Controller('api/v1/admin/statistics')
@Roles('SUPER_ADMIN')
export class StatisticsController {
  constructor(
    @Inject(StatisticsService) private readonly statistics: StatisticsService,
    @Inject(StatisticsCsvService) private readonly csv: StatisticsCsvService,
  ) {}

  /** 商品销量排行（R9：OrderItem 区间聚合，金额单位分） */
  @Get('products/top')
  async getTopProducts(
    @Query(new ZodValidationPipe(StatisticsTopProductsQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
      limit: number;
      lang: 'en' | 'id' | 'zh' | 'pt' | 'tet';
    },
  ) {
    const data = await this.statistics.getTopProducts(query);
    return { success: true as const, data };
  }

  /** 商品排行导出 CSV（lang 定死为 query 显式传——admin-web locale 在 cookie） */
  @Get('products/export')
  async exportTopProducts(
    @Query(new ZodValidationPipe(StatisticsExportQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
      lang: 'en' | 'id' | 'zh' | 'pt' | 'tet';
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.csv.exportTopProductsCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="top-products-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }
}
