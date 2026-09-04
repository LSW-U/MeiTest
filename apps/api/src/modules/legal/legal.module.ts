/**
 * Legal Module — 法律文档下发（P5 #3，2026-08-25）
 *
 * 公开 endpoint：GET /api/v1/common/legal/:docType（TERMS / PRIVACY）
 * 复用 CommonModule 前缀，common/* 自动放行 DeviceTypeGuard。
 */
import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
