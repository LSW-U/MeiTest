/**
 * Promotion Controller - 促销管理（W7-ext-G）
 *
 * 路由前缀 /api/v1/admin/promotions（仅 super_admin）
 *
 * 7 endpoints：
 *   GET    /                列表
 *   GET    /:id             详情
 *   POST   /                创建
 *   PATCH  /:id             编辑
 *   POST   /:id/activate    激活
 *   POST   /:id/pause       暂停
 *   POST   /:id/delete      软删
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { PromotionService } from './promotion.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

const ListPromotionsQuery = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'DELETED']).optional(),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY']).optional(),
  keyword: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const CreatePromotionRequest = z.object({
  code: z.string().min(3).max(20),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY']),
  value: z.number().int().nonnegative(),
  minOrderAmount: z.number().int().nonnegative().optional(),
  maxDiscountAmount: z.number().int().nonnegative().nullable().optional(),
  totalQuota: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

const UpdatePromotionRequest = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  value: z.number().int().nonnegative().optional(),
  minOrderAmount: z.number().int().nonnegative().optional(),
  maxDiscountAmount: z.number().int().nonnegative().nullable().optional(),
  totalQuota: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

@Controller('api/v1/admin/promotions')
@Roles('super_admin')
export class PromotionController {
  constructor(@Inject(PromotionService) private readonly promoService: PromotionService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(ListPromotionsQuery)) query: z.infer<typeof ListPromotionsQuery>) {
    const data = await this.promoService.list({
      status: query.status,
      type: query.type,
      keyword: query.keyword,
      limit: query.limit,
    });
    return { success: true as const, data };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const data = await this.promoService.detail(id);
    return { success: true as const, data };
  }

  @Post()
  @Audit({ resource: 'Promotion' })
  async create(@Body(new ZodValidationPipe(CreatePromotionRequest)) body: z.infer<typeof CreatePromotionRequest>) {
    const data = await this.promoService.create(body);
    return { success: true as const, data };
  }

  @Patch(':id')
  @Audit({ resource: 'Promotion', resourceIdParam: 'id' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePromotionRequest)) body: z.infer<typeof UpdatePromotionRequest>,
  ) {
    const data = await this.promoService.update(id, body);
    return { success: true as const, data };
  }

  @Post(':id/activate')
  @Audit({ resource: 'Promotion', resourceIdParam: 'id' })
  async activate(@Param('id') id: string) {
    const data = await this.promoService.activate(id);
    return { success: true as const, data };
  }

  @Post(':id/pause')
  @Audit({ resource: 'Promotion', resourceIdParam: 'id' })
  async pause(@Param('id') id: string) {
    const data = await this.promoService.pause(id);
    return { success: true as const, data };
  }

  @Post(':id/delete')
  @Audit({ resource: 'Promotion', resourceIdParam: 'id' })
  async remove(@Param('id') id: string) {
    const data = await this.promoService.remove(id);
    return { success: true as const, data };
  }
}

const ValidatePromotionRequest = z.object({
  code: z.string().min(1).max(20),
  orderAmount: z.number().int().nonnegative(),
  deliveryFee: z.number().int().nonnegative().optional(),
});

/**
 * Client Promotion Controller - 客户端促销校验（W7-ext-G P1-3）
 *
 * 路由前缀 /api/v1/promotions（role: customer，登录用户）
 * 购物车实时预览折扣，不 increment usedCount。
 */
@Controller('api/v1/promotions')
@Roles('customer')
export class ClientPromotionController {
  constructor(@Inject(PromotionService) private readonly promoService: PromotionService) {}

  @Post('validate')
  async validate(@Body(new ZodValidationPipe(ValidatePromotionRequest)) body: z.infer<typeof ValidatePromotionRequest>) {
    const data = await this.promoService.validatePromotion(
      body.code,
      body.orderAmount,
      body.deliveryFee ?? 0,
    );
    return { success: true as const, data };
  }
}
