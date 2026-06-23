/** Pricing Module（W 流程 2026-06-24） */
import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { ClientPricingController, AdminPricingController } from './pricing.controller';

@Module({
  controllers: [ClientPricingController, AdminPricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
