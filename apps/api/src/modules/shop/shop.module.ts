/**
 * Shop Module（W 流程 2026-06-24）
 *
 * 单一商家（MVP）：1 条预置 shop，无 CRUD 多实例，只有 GET + PATCH
 */
import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';

@Module({
  controllers: [ShopController],
  providers: [ShopService],
  exports: [ShopService],
})
export class ShopModule {}
