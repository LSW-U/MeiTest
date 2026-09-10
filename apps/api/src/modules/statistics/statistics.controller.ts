/**
 * Statistics Controller（数据分析报表）
 *
 * 路径：
 *   GET /api/v1/admin/statistics/products/top     商品销量排行（R9）
 *   GET /api/v1/admin/statistics/products/export  商品排行导出 CSV（lang 显式传）
 *   GET /api/v1/admin/statistics/riders           骑手绩效（批C，R5 DeliveryTask 归属）
 *   GET /api/v1/admin/statistics/riders/export    骑手绩效导出 CSV（lang 显式传）
 *
 * 来源：数据分析报表模块 批B（2026-09-10）/ 批C（2026-09-10）
 */
import { Controller, Get, Query, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { StatisticsService } from './statistics.service';
import { StatisticsCsvService } from './statistics-csv.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  StatisticsRidersQuery,
  StatisticsTopProductsQuery,
  StatisticsExportQuery,
  StatisticsRefundsQuery,
  StatisticsCustomersQuery,
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

  /** 骑手绩效（批C：DeliveryTask 归属 R5 口径，金额单位分） */
  @Get('riders')
  async getRiders(
    @Query(new ZodValidationPipe(StatisticsRidersQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
    },
  ) {
    const data = await this.statistics.getRiders(query);
    return { success: true as const, data };
  }

  /** 骑手绩效导出 CSV（lang 定死为 query 显式传——admin-web locale 在 cookie） */
  @Get('riders/export')
  async exportRiders(
    @Query(new ZodValidationPipe(StatisticsExportQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
      lang: 'en' | 'id' | 'zh' | 'pt' | 'tet';
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.csv.exportRidersCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="riders-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  /** 退款统计（批D：计入口径 status ∈ APPROVED/COMPLETED，rate 分母=同期 GMV 状态订单数） */
  @Get('refunds')
  async getRefunds(
    @Query(new ZodValidationPipe(StatisticsRefundsQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
    },
  ) {
    const data = await this.statistics.getRefunds(query);
    return { success: true as const, data };
  }

  /** 退款统计导出 CSV（批D：reason 展示枚举原文，约定外值归 OTHER；lang 显式传） */
  @Get('refunds/export')
  async exportRefunds(
    @Query(new ZodValidationPipe(StatisticsExportQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
      lang: 'en' | 'id' | 'zh' | 'pt' | 'tet';
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.csv.exportRefundsCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="refunds-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  /** 客户分析（批E R4：新客=全局首单在区间；复购=区间≥2单；AOV=GMV/订单数 非 ARPU） */
  @Get('customers')
  async getCustomers(
    @Query(new ZodValidationPipe(StatisticsCustomersQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
    },
  ) {
    const data = await this.statistics.getCustomers(query);
    return { success: true as const, data };
  }

  /** 客户分析导出 CSV（批E：指标汇总型键值两列式，指标名按 lang；lang 显式传） */
  @Get('customers/export')
  async exportCustomers(
    @Query(new ZodValidationPipe(StatisticsExportQuery))
    query: {
      range?: 'today' | 'week' | 'month';
      from?: string;
      to?: string;
      lang: 'en' | 'id' | 'zh' | 'pt' | 'tet';
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.csv.exportCustomersCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }
}
