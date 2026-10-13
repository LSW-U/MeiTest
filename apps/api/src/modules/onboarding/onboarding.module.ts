/**
 * Onboarding Module — 引导页内容可配置（批1，2026-10-14）
 *
 * 两类端点：
 *   - ClientOnboardingController  GET /api/v1/client/onboarding/slides（@Public 匿名，首启无 token）
 *   - AdminOnboardingController   GET/POST/PATCH/DELETE /api/v1/admin/onboarding/slides（SUPER_ADMIN）
 *
 * 独立表 OnboardingSlide（方案v2 D1 拍板）：SystemConfig 是 key-value 字符串存储，
 * 不适合结构化多行 slides；配置型简单值仍走 SystemConfig（support-config 先例）。
 */
import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { ClientOnboardingController, AdminOnboardingController } from './onboarding.controller';
import { StorageModule } from '../../shared/storage/storage.module';

@Module({
  // StorageModule：isOwnUrl imageUrl 归属校验（同 Feedback 模式）
  imports: [StorageModule],
  controllers: [ClientOnboardingController, AdminOnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
