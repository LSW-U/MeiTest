/**
 * Rate Controller — 客户端汇率查询（批A 汇率体系，微信支付预留 2026-09-08，方案V2 §3.1）
 *
 * 路由前缀 /api/v1/client/rates（deviceType=client_app）
 *
 * 端点：
 *   GET /exchange?to=CNY   当日生效汇率（当日无表 → 兜底值 + source=FALLBACK）
 *
 * 显示口径（方案V2 D5 + 风险 8）：
 *   - 本接口仅供支付页"≈¥"估算展示；结算/对账一律以订单快照（Order.exchangeRate/estimatedCnyAmount）为准
 *   - source=FALLBACK 时前端应提示"按固定汇率估算"
 */
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientExchangeRateQuery } from '@meimart/api-contract';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { RateService } from './rate.service';

@Controller('api/v1/client/rates')
@Roles('CUSTOMER')
export class RateController {
  constructor(@Inject(RateService) private readonly rateService: RateService) {}

  /** 当日生效汇率（USD→CNY；source=FALLBACK 供前端提示固定汇率估算） */
  @Get('exchange')
  async getExchangeRate(
    @Query(new ZodValidationPipe(ClientExchangeRateQuery, 'E-RATE-001'))
    query: { to: 'CNY' },
  ) {
    const data = await this.rateService.getEffectiveRate(query.to);
    return { success: true as const, data };
  }
}
