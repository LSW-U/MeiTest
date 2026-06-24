/** Catalog Module（W 流程 2026-06-24）：商品/SKU/分类/Banner */
import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import {
  ClientProductController,
  ClientCatalogController,
  AdminProductController,
  AdminSkuController,
  AdminCategoryController,
  AdminBannerController,
} from './catalog.controller';

@Module({
  controllers: [
    ClientProductController,
    ClientCatalogController,
    AdminProductController,
    AdminSkuController,
    AdminCategoryController,
    AdminBannerController,
  ],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
