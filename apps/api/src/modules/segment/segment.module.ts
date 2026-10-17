/**
 * Segment Module — RFM 分层运营（客户画像批2 2026-10-18）
 *
 * 消费批1 画像基建（G5 阈值 / lifecycle 阶段机 / R-a 聚合口径），不复制语义。
 * 导出 SegmentService 供批4 触达自动化复用（grant 端点共用，C5 规则解析）。
 */
import { Module } from '@nestjs/common';
import { SegmentService } from './segment.service';
import { AdminSegmentController } from './admin-segment.controller';

@Module({
  controllers: [AdminSegmentController],
  providers: [SegmentService],
  exports: [SegmentService],
})
export class SegmentModule {}
