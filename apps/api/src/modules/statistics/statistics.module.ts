/**
 * Statistics Module（数据分析报表）
 *
 * - 商品排行（批B，2026-09-10）：products/top + products/export
 * - 后续批次：骑手绩效（批C）/ 退款统计（批D）/ 客户分析（批E）
 *
 * 复用：shared/statistics 公共层（range.ts 时间切日 + metrics.ts 口径常量，批A 铺底）
 */
import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { StatisticsCsvService } from './statistics-csv.service';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService, StatisticsCsvService],
})
export class StatisticsModule {}
