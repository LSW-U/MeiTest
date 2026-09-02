/**
 * RiderDeposit Controller — 骑手侧保证金 3 端点（批 B，2026-09-02）
 *
 * 路由（全部 role=rider，rider_app deviceType 由全局 DeviceTypeGuard 校验）：
 *   POST /api/v1/rider/deposit/requests          提交缴纳申请（ONLINE_MOCK / OFFLINE_COD）
 *   POST /api/v1/rider/deposit/requests/:id/pay-mock  线上模拟支付（即时 CONFIRMED + 累加）
 *   GET  /api/v1/rider/deposit/status            状态（余额 / 命中档位 / 最近 10 条申请）
 *
 * 契约：packages/api-contract/src/schemas/rider.ts（RiderDeposit* 系列）
 */
import { Controller, Get, Post, Body, Param, Req, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { z } from 'zod';
import { RiderDepositService } from './deposit.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser extends Request {
  user?: RequestUser;
}

/** 提交申请 schema（与契约 CreateRiderDepositRequest 同步） */
const CreateDepositRequestSchema = z.object({
  channel: z.enum(['ONLINE_MOCK', 'OFFLINE_COD']),
  amount: z.number().int().min(100),
  locationId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

/** pay-mock :id 参数（批B审查 P3-1：非法 uuid → 400，不落 404/500） */
const DepositIdParam = z.string().uuid();

@Controller('api/v1/rider/deposit')
@Roles('RIDER')
export class RiderDepositController {
  constructor(@Inject(RiderDepositService) private readonly depositService: RiderDepositService) {}

  /**
   * 提交缴纳申请
   * - ONLINE_MOCK：创建 PENDING（待 pay-mock）
   * - OFFLINE_COD：locationId 必填（且 enabled=true），创建 PENDING（待 admin 确认）
   */
  @Post('requests')
  @Audit({ resource: 'RiderDeposit' })
  async createRequest(
    @Body(new ZodValidationPipe(CreateDepositRequestSchema)) body: z.infer<typeof CreateDepositRequestSchema>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const deposit = await this.depositService.createRequest({
      riderUserId: user.sub,
      channel: body.channel,
      amount: body.amount,
      locationId: body.locationId,
      note: body.note,
    });
    return { success: true as const, data: deposit };
  }

  /** 线上模拟支付（幂等：已 CONFIRMED 直接返回成功） */
  @Post('requests/:id/pay-mock')
  @Audit({ resource: 'RiderDeposit' })
  async payMock(
    @Param('id', new ZodValidationPipe(DepositIdParam)) id: string,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.depositService.payMock(user.sub, id);
    return { success: true as const, data: result };
  }

  /** 状态查询（余额 / 命中档位 / 最近 10 条申请） */
  @Get('status')
  async getStatus(@Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const status = await this.depositService.getStatus(user.sub);
    return { success: true as const, data: status };
  }

  // ===== 补端点批（2026-09-03）：骑手端只读两端点（COD 下拉 / 档位提示） =====

  /** 启用缴纳点列表（线下 COD Tab 下拉；admin 同源只读 + enabled 过滤） */
  @Get('locations')
  async listLocations() {
    const items = await this.depositService.listEnabledLocations();
    return { success: true as const, data: items };
  }

  /** 启用档位列表（缴纳页「选 $X → 上限 $Y」提示；与资格派生同口径） */
  @Get('tiers')
  async listTiers() {
    const items = await this.depositService.listEnabledTiers();
    return { success: true as const, data: items };
  }
}
