/**
 * Geo Controller — 地址 geocoding（W7 P0-3）
 *
 * 1 个 endpoint：
 *   - GET /api/v1/common/geo/geocode?address=xxx  公开（无需登录，地址输入时调）
 *
 * 设计：
 *   - Public（用户在保存地址前可能未登录，例如注册流程中的地址输入）
 *   - deviceType 不限制（/common/* 前缀自动放行 DeviceTypeGuard）
 *   - 用 zod 校验 query（address 长度 2-500）
 */
import { Controller, Get, Query, Inject } from '@nestjs/common';
import { GeocodeRequest } from '@meimart/api-contract';
import { GeoService } from './geo.service';
import { Public } from '../../../shared/decorators/public.decorator';
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe';

@Controller('api/v1/common/geo')
export class GeoController {
  constructor(@Inject(GeoService) private readonly geo: GeoService) {}

  /** 地址 → 经纬度（公开，无需登录） */
  @Public()
  @Get('geocode')
  async geocode(
    @Query(new ZodValidationPipe(GeocodeRequest)) query: { address: string },
  ) {
    const result = await this.geo.geocode(query.address);
    return { success: true, data: result };
  }
}
