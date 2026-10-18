/**
 * Segment Module — RFM 分层运营（客户画像批2 2026-10-18）
 *
 * 消费批1 画像基建（G5 阈值 / lifecycle 阶段机 / R-a 聚合口径），不复制语义。
 * 导出 SegmentService 供批4 触达自动化复用（grant 端点共用，C5 规则解析）。
 */
import { Module } from '@nestjs/common';
import { SegmentService } from './segment.service';
import { AdminSegmentController } from './admin-segment.controller';

/** SegmentService DI token（批4 engagement 跨模块注入用，防 tsx 装饰器元数据缺失）
 *  字符串常量（P1-1 修复 2026-10-18）：两端必须逐字一致，对齐 notification.module
 *  'NotificationEventServiceToken' 字符串先例——Symbol 两端导入同一实例易断裂 */
export const SEGMENT_SERVICE_TOKEN = 'SegmentServiceToken';

@Module({
  controllers: [AdminSegmentController],
  providers: [
    SegmentService,
    { provide: SEGMENT_SERVICE_TOKEN, useExisting: SegmentService },
  ],
  exports: [SegmentService, SEGMENT_SERVICE_TOKEN],
})
export class SegmentModule {}
