/**
 * Rider Controller — 骑手入驻 + 上下班 + admin 审核
 *
 * 路由分组：
 *   /api/v1/common/rider/apply         POST   入驻申请（deviceType=client_app，尚未持 rider token）
 *   /api/v1/rider/profile              GET    查询自己的 profile（role=rider）
 *   /api/v1/rider/duty                 PATCH  上下班切换 + 接单模式（role=rider）
 *   /api/v1/rider/heartbeat            POST   心跳续期（role=rider）
 *   /api/v1/admin/rider-applications   GET    列表（admin 审核）
 *   /api/v1/admin/rider-applications/:id/review  POST  审核（approve/reject）
 *
 * 注：apply 用 common 前缀（用户尚未 rider deviceType，用 client_app 登录后申请）
 *     审核通过后用户重登，token deviceType 变为 rider_app，才能调 /rider/* 路由
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { RiderService } from './rider.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

/** 入驻申请 schema（rider.ts contract 缺，本地补 zod） */
const ApplyRiderRequest = z.object({
  riderName: z.string().min(1).max(50),
  phone: z.string().min(6).max(20),
  vehicleType: z.enum(['MOTORCYCLE', 'BICYCLE', 'CAR']).optional(),
  vehiclePlate: z.string().max(20).optional(),
  idCardNumber: z.string().min(6).max(30),
  preferredWarehouseIds: z.array(z.string().uuid()).optional(),
});

/** 上下班切换 schema */
const UpdateDutyRequest = z.object({
  status: z.enum(['OFFLINE', 'ONLINE', 'BUSY']),
  acceptMode: z.enum(['GRAB', 'AUTO_DISPATCH']).optional(),
});

/** 审核 schema */
const ReviewApplicationRequest = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rejectReason: z.string().max(500).optional(),
});

const ListApplicationsQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface RequestWithUser {
  user?: RequestUser;
}

/**
 * 入驻申请 controller（common 前缀，role=customer）
 *
 * 注：用户在 client_app 中登录后申请成为骑手，审核通过后改用 rider_app deviceType。
 * B2 修复：必须显式 @Roles('customer') — RolesGuard 默认 least-privilege 拒绝未声明 @Roles 的端点。
 */
@Controller('api/v1/common/rider')
@Roles('customer')
export class RiderApplicationController {
  constructor(@Inject(RiderService) private readonly riderService: RiderService) {}

  @Post('apply')
  @Audit({ resource: 'RiderProfile' })
  async apply(
    @Body(new ZodValidationPipe(ApplyRiderRequest)) body: z.infer<typeof ApplyRiderRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const profile = await this.riderService.apply({
      userId: user.sub,
      riderName: body.riderName,
      phone: body.phone,
      vehicleType: body.vehicleType,
      vehiclePlate: body.vehiclePlate,
      idCardNumber: body.idCardNumber,
      preferredWarehouseIds: body.preferredWarehouseIds,
    });
    return { success: true as const, data: profile };
  }
}

/**
 * 骑手工作台 controller（rider 前缀，role=rider）
 */
@Controller('api/v1/rider')
@Roles('rider')
export class RiderController {
  constructor(@Inject(RiderService) private readonly riderService: RiderService) {}

  /** 查询自己的 profile */
  @Get('profile')
  async getProfile(@Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const profile = await this.riderService.getProfile(user.sub);
    return { success: true as const, data: profile };
  }

  /** 上下班切换 + 接单模式 */
  @Patch('duty')
  @Audit({ resource: 'RiderProfile' })
  async updateDuty(
    @Body(new ZodValidationPipe(UpdateDutyRequest)) body: z.infer<typeof UpdateDutyRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const profile = await this.riderService.updateDuty({
      riderId: user.sub,
      status: body.status,
      acceptMode: body.acceptMode,
    });
    return { success: true as const, data: profile };
  }

  /** 心跳续期（rider WS 心跳或 HTTP 兜底时调） */
  @Post('heartbeat')
  async heartbeat(@Req() req: RequestWithUser) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.riderService.heartbeat(user.sub);
    return { success: true as const, data: result };
  }
}

/**
 * Admin 审核 controller（admin 前缀，role=super_admin）
 */
@Controller('api/v1/admin/rider-applications')
@Roles('super_admin')
export class RiderApplicationAdminController {
  constructor(@Inject(RiderService) private readonly riderService: RiderService) {}

  /** 列表（按 status 过滤） */
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListApplicationsQuery)) query: z.infer<typeof ListApplicationsQuery>,
  ) {
    const result = await this.riderService.listPendingApplications({
      status: query.status,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 审核（approve/reject） */
  @Post(':id/review')
  @Audit({ resource: 'RiderProfile', resourceIdParam: 'id' })
  async review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewApplicationRequest)) body: z.infer<typeof ReviewApplicationRequest>,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    if (!user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const profile = await this.riderService.review({
      applicationId: id,
      reviewerId: user.sub,
      decision: body.decision,
      rejectReason: body.rejectReason,
    });
    return { success: true as const, data: profile };
  }
}
