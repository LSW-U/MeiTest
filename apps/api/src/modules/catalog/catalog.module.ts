/** Catalog Module（W 流程 2026-06-24）：商品/SKU/分类/Banner；批F 追加商品批量导入 */
import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SearchModule } from '../search/search.module';
import {
  ClientProductController,
  ClientCatalogController,
  AdminProductController,
  AdminSkuController,
  AdminCategoryController,
  AdminBannerController,
} from './catalog.controller';
import { AdminProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';

@Module({
  imports: [SearchModule],
  controllers: [
    ClientProductController,
    ClientCatalogController,
    AdminProductController,
    AdminSkuController,
    AdminCategoryController,
    AdminBannerController,
    AdminProductImportController,
  ],
  providers: [CatalogService, ProductImportService],
  exports: [CatalogService],
})
export class CatalogModule {}
