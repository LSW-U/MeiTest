/**
 * Feedback Module — 用户反馈（P22 F1，2026-08-19）
 *
 * 提供：
 *   - FeedbackService（C 端提交业务，images isOwnUrl 校验）
 *   - FeedbackController（C 端 1 端点，前缀 /api/v1/client/feedback）
 *
 * 依赖：
 *   - Prisma 全局 db 单例（shared/db，不注入）
 *   - StorageModule（images URL host 白名单校验，防 SSRF/追踪/钓鱼，同 Refund 模式）
 *   - AuditInterceptor（全局，读 @Audit metadata 写 AuditLog）
 */
import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { AdminFeedbackController } from './admin-feedback.controller';
import { StorageModule } from '../../shared/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [FeedbackController, AdminFeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
