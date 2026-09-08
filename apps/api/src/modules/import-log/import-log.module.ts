/** ImportLog Module（批E D5 v2 2026-09-07：导入历史跨批通用查询，批F 复用） */
import { Module } from '@nestjs/common';
import { ImportLogService } from './import-log.service';
import { ImportLogController } from './import-log.controller';

@Module({
  controllers: [ImportLogController],
  providers: [ImportLogService],
  exports: [ImportLogService],
})
export class ImportLogModule {}
