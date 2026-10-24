/**
 * Statistics Module（数据分析报表）
 *
 * - 商品排行（批B，2026-09-10）：products/top + products/export
 * - 缺货看板（缺货履约闭环批4，2026-10-24）：out-of-stock（A5 三指标，OosBoardService 独立只读聚合）
 * - 后续批次：骑手绩效（批C）/ 退款统计（批D）/ 客户分析（批E）
 *
 * 复用：shared/statistics 公共层（range.ts 时间切日 + metrics.ts 口径常量，批A 铺底）
 */
import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { StatisticsCsvService } from './statistics-csv.service';
import { OosBoardService } from './oos-board.service';

@Module({
  controllers: [StatisticsController],
  providers: [StatisticsService, StatisticsCsvService, OosBoardService],
})
export class StatisticsModule {}
