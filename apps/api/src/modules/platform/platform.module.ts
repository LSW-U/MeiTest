/**
 * Platform Module（流程 M 治理/财务）
 *
 * - Dashboard：平台数据看板（GMV/订单数/在线骑手/异常订单/仓库钻取）
 * - Audit：审计日志查询/导出（复用 W1 AuditLog 表）
 * - SystemConfig：平台 key-value 配置 + Redis 缓存
 *
 * W3 接入：im / settle 模块（独立 module 文件）
 * W4 接入：platform 审计进一步完善（CSV 模板、字段高级筛选）
 */
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { SystemConfigController } from './system-config.controller';
import { SystemConfigService } from './system-config.service';

@Module({
  controllers: [DashboardController, AuditController, SystemConfigController],
  providers: [DashboardService, AuditService, SystemConfigService],
  exports: [SystemConfigService, AuditService],
})
export class PlatformModule {}
