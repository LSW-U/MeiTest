/**
 * Admin Rate Controller — 后台汇率维护（批A 汇率体系，微信支付预留 2026-09-08，方案V2 §3.1）
 *
 * 端点（/api/v1/admin/rates）：
 *   POST /exchange   按日维护汇率（upsert，@Audit）
 *   PUT  /exchange   同 POST（restful 幂等语义，同一 handler）
 *   GET  /exchange   汇率历史（生效日期倒序 + 游标分页）
 *
 * 权限：仅 SUPER_ADMIN（汇率影响人民币显示与对账一致性，属敏感配置）
 *
 * 口径：请求 rate 为十进制（如 7.2345），服务端转万分位落库；响应含 rate（万分位）+ rateDecimal。
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ListExchangeRatesQuery, UpsertExchangeRateRequest } from '@meimart/api-contract';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { RateService } from './rate.service';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/admin/rates')
@Roles('SUPER_ADMIN')
export class AdminRateController {
  constructor(@Inject(RateService) private readonly rateService: RateService) {}

  /**
   * 按日维护汇率（upsert；@Audit 留痕——汇率属影响资金口径的敏感配置）
   *
   * 错误码语义切分（P2-1 审查备注，接受现状）：ZodValidationPipe 对整个 body 只支持
   * 单一错误码，故 rateDate **格式**错与 rate 区间错统一返回 E-RATE-001（details 数组
   * 带逐字段 zod message 可区分）；**真实日历日** round-trip 复核在 service 层返回
   * E-RATE-002。若要格式错并入 002，需 pipe 支持按 path 映射 code，MVP 不引入。
   */
  @Post('exchange')
  @Audit({ resource: 'ExchangeRate' })
  async upsert(
    @Req() req: RequestWithUser,
    @Body(new ZodValidationPipe(UpsertExchangeRateRequest, 'E-RATE-001'))
    body: { rateDate: string; rate: number },
  ) {
    if (!req.user) {
      throw new HttpException(
        { code: 'E-AUTH-002', message: 'auth required' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const rate = await this.rateService.upsertRate({
      rateDate: body.rateDate,
      rate: body.rate,
      operatorId: req.user.sub,
    });
    return { success: true as const, data: { rate } };
  }

  /** 同 POST（幂等 upsert 语义） */
  @Put('exchange')
  @Audit({ resource: 'ExchangeRate' })
  async upsertPut(
    @Req() req: RequestWithUser,
    @Body(new ZodValidationPipe(UpsertExchangeRateRequest, 'E-RATE-001'))
    body: { rateDate: string; rate: number },
  ) {
    return this.upsert(req, body);
  }

  /**
   * 汇率历史（生效日期倒序 + 游标分页；startDate/endDate 过滤）
   *
   * 日期校验分两层：zod 正则挡格式（非 YYYY-MM-DD → E-RATE-001）；
   * 真实日历日 round-trip 复核在 listRates service 层（E-RATE-002），与 upsert 同口径。
   */
  @Get('exchange')
  async list(
    @Query(new ZodValidationPipe(ListExchangeRatesQuery, 'E-RATE-001'))
    query: {
      startDate?: string;
      endDate?: string;
      cursor?: string;
      limit?: number;
    },
  ) {
    const result = await this.rateService.listRates(query);
    return { success: true as const, data: result };
  }
}
