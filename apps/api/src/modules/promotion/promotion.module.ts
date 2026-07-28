/**
 * Promotion Module - 促销管理（W7-ext-G）
 */
import { Module } from '@nestjs/common';
import { PromotionController, ClientPromotionController, ClientCouponController } from './promotion.controller';
import { PromotionService } from './promotion.service';

@Module({
  controllers: [PromotionController, ClientPromotionController, ClientCouponController],
  providers: [PromotionService],
  exports: [PromotionService],
})
export class PromotionModule {}
