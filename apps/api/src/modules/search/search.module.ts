/** Search Module — 热搜（Redis ZSET + SearchLog 审计 + 运营种子词，2026-07-31） */
import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { ClientSearchController, AdminHotSearchController } from './search.controller';

@Module({
  controllers: [ClientSearchController, AdminHotSearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
