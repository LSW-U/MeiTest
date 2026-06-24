/**
 * Pricing Controllers（W 流程 2026-06-24）
 *
 * - ClientPricingController  /api/v1/client/pricing/*   配送费计算（customer）
 * - AdminPricingController   /api/v1/admin/pricing/*    配置（super_admin）
 */
import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  Param,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { PricingService } from './pricing.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

const UpdateBaseFeeRequest = z.object({
  baseFee: z.number().int().nonnegative(),
});

@Controller('api/v1/client/pricing')
@Roles('customer')
export class ClientPricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Get('delivery-fee')
  async deliveryFee(
    @Query('warehouseId') warehouseId?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    if (!warehouseId || !lat || !lng) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: 'warehouseId, lat, lng query params required',
      });
    }
    const data = await this.pricing.calcDeliveryFee(warehouseId, Number(lat), Number(lng));
    return { success: true, data };
  }

  @Get('min-order-check')
  async minOrderCheck(
    @Query('warehouseId') warehouseId?: string,
    @Query('cartTotal') cartTotal?: string,
  ) {
    if (!warehouseId || !cartTotal) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: 'warehouseId, cartTotal query params required',
      });
    }
    const data = await this.pricing.checkMinOrder(warehouseId, Number(cartTotal));
    return { success: true, data };
  }
}

@Controller('api/v1/admin/pricing')
@Roles('super_admin')
export class AdminPricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Get('config')
  async listConfig() {
    const data = await this.pricing.listWarehousePricingConfig();
    return { success: true, data };
  }

  @Patch('warehouses/:warehouseId/base-fee')
  @Audit({ resource: 'PricingConfig' })
  async updateBaseFee(
    @Param('warehouseId') warehouseId: string,
    @Body(new ZodValidationPipe(UpdateBaseFeeRequest)) body: { baseFee: number },
  ) {
    const data = await this.pricing.updateBaseFee(warehouseId, body.baseFee);
    return { success: true, data };
  }
}
