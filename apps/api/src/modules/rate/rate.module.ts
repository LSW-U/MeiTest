/**
 * Rate Module — 汇率模块（批A 汇率体系，微信支付预留 2026-09-08，方案V2 §3.1）
 *
 * 提供：
 *   - admin 维护接口（POST/PUT/GET /api/v1/admin/rates/exchange，SUPER_ADMIN + @Audit）
 *   - client 查询接口（GET /api/v1/client/rates/exchange，含 FALLBACK 标记）
 *   - 下单快照钩子：order.service 经模块级函数直接复用（resolveOrderEffectiveRate /
 *     buildOrderRateFields），不经 DI，无模块间依赖
 */
import { Module } from '@nestjs/common';
import { AdminRateController } from './admin-rate.controller';
import { RateController } from './rate.controller';
import { RateService } from './rate.service';

@Module({
  controllers: [AdminRateController, RateController],
  providers: [RateService],
  exports: [RateService],
})
export class RateModule {}
