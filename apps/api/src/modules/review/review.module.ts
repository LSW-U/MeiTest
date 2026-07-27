/**
 * Review Module — 评论中心（reviews-2）
 *
 * 提供：
 *   - ReviewService（C 端 + Admin 业务，rating 全量重算）
 *   - ReviewController（C 端 4 端点，前缀 /api/v1/client）
 *   - AdminReviewController（Admin 4 端点，前缀 /api/v1/admin/reviews）
 *
 * 依赖：
 *   - Prisma 全局 db 单例（shared/db，不注入）
 *   - AuditInterceptor（全局，读 @Audit metadata 写 AuditLog）
 */
import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { AdminReviewController } from './admin-review.controller';

@Module({
  controllers: [ReviewController, AdminReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
