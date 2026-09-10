/**
 * Upload Module — 图片上传（W7-feature + P13 售后图片 client 端点 + 批C 孤儿清理）
 *
 * 批C（2026-09-10）：孤儿图片清理定时任务（U4/U4P/U10）——
 * ORPHAN_CLEANUP_QUEUE 每日一次扫描 MinIO vs DB 引用集合（13 字段），
 * 默认 DRY-RUN，ORPHAN_CLEANUP_EXECUTE=true 才真删。
 */
import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { UploadController } from './upload.controller';
import { ClientUploadController } from './upload-client.controller';
import { RiderUploadController } from './rider-upload.controller';
import { OrphanCleanupService } from './orphan-cleanup.service';
import { OrphanCleanupScheduler } from './orphan-cleanup.scheduler';
import { OrphanCleanupProcessor } from './orphan-cleanup.processor';
import { StorageModule } from '../../shared/storage/storage.module';
import { StorageService } from '../../shared/storage/storage.service';
import { ORPHAN_CLEANUP_QUEUE } from '../../shared/queue';

@Module({
  imports: [
    StorageModule,
    // 批C：孤儿清理队列（每日一次定时扫描，DRY-RUN 默认）
    BullModule.registerQueue({
      name: ORPHAN_CLEANUP_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [UploadController, ClientUploadController, RiderUploadController],
  providers: [
    OrphanCleanupService,
    OrphanCleanupProcessor,
    OrphanCleanupScheduler,
    // 显式声明 DI token，避免 tsx esbuild 不生成 emitDecoratorMetadata 导致 Inject token 无法解析
    { provide: 'StorageServiceToken', useExisting: StorageService },
    // BullMQ 队列注入 token（getQueueToken 必须带队列名，审查 P1-2 同款）
    { provide: 'OrphanCleanupQueueToken', useExisting: getQueueToken(ORPHAN_CLEANUP_QUEUE) },
  ],
})
export class UploadModule {}
