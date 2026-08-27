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
@Roles('CUSTOMER')
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

  // P2-3 修复（2026-08-27 审查报告）：移除 /client/pricing/min-order-check 端点
  //   checkMinOrder 死代码（createOrder 不调用、minOrderAmount 恒 0、seed 那条已删），
  //   端点形同虚设且误导（E-PRICING-001 起送价校验本期不生效）。
  //   起送价需求激活时再恢复端点 + 实装 checkMinOrder（读 warehouse.minOrderAmount 字段 + 新 migration）。
  //   ⚠️ breaking change：删 endpoint，跨 repo 前端需同步删调用（W2-COLLABORATION.md §3.7 标 [BREAKING]）。
  //
  //   批次2 审查报告 P2-1（2026-08-28）：errors.json 五语言仍保留 E-PRICING-001 文案
  //   （en/zh/id/pt/tet 各 1 条），属【有意占位】非漏清理——schema 仍保留
  //   warehouse.minOrderAmount 字段（@default 0），起送价需求激活时端点 + checkMinOrder
  //   实装后 E-PRICING-001 立即可用，无需重规划错误码段（CLAUDE.md §3.4）。后端零抛出、
  //   admin-web/MeiMart1.0 前端零引用，占位 key 无运行时副作用（all-exceptions.filter
  //   按 code 查 errors.json，未抛出即永不命中）。
}

@Controller('api/v1/admin/pricing')
@Roles('SUPER_ADMIN')
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
