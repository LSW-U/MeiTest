/**
 * Promotion Module - 促销管理（W7-ext-G）+ P1 领券卡包体系（2026-07-31）
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PromotionController, ClientPromotionController, ClientCouponController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { CouponExpireProcessor } from './coupon-expire.processor';
import { CouponExpireScheduler } from './coupon-expire.scheduler';
import { COUPON_EXPIRE_QUEUE } from '../../shared/queue';

@Module({
  imports: [
    BullModule.registerQueue({
      name: COUPON_EXPIRE_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  controllers: [PromotionController, ClientPromotionController, ClientCouponController],
  providers: [PromotionService, CouponExpireProcessor, CouponExpireScheduler],
  exports: [PromotionService],
})
export class PromotionModule {}
