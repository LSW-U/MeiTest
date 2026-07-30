/** Home Module - 首页活动入口（PromoDock，路线 A 配置接口，零 DB 依赖） */
import { Module } from '@nestjs/common';
import { HomeService } from './home.service';
import { ClientHomeController } from './home.controller';

@Module({
  controllers: [ClientHomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
