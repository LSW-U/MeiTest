/** Catalog Module（W 流程 2026-06-24）：商品/SKU/分类/Banner；批F 追加商品批量导入；批6 协同过滤 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CatalogService, COLLABORATIVE_FILTER_TOKEN } from './catalog.service';
import { CollaborativeFilterService } from './collaborative-filter.service';
import { CollaborativeProcessor } from './collaborative.processor';
import { CollaborativeScheduler } from './collaborative.scheduler';
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
import { AdminCollaborativeController } from './admin-collaborative.controller';
import { ProductImportService } from './product-import.service';
import { COLLABORATIVE_QUEUE } from '../../shared/queue';

@Module({
  imports: [
    SearchModule,
    BullModule.registerQueue({
      name: COLLABORATIVE_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [
    ClientProductController,
    ClientCatalogController,
    AdminProductController,
    AdminSkuController,
    AdminCategoryController,
    AdminBannerController,
    AdminProductImportController,
    AdminCollaborativeController,
  ],
  providers: [
    CatalogService,
    ProductImportService,
    CollaborativeFilterService,
    CollaborativeProcessor,
    CollaborativeScheduler,
    // 显式 DI token（tsx 不 emit 装饰器元数据——本仓红线）
    { provide: COLLABORATIVE_FILTER_TOKEN, useExisting: CollaborativeFilterService },
  ],
  exports: [CatalogService, CollaborativeFilterService],
})
export class CatalogModule {}
