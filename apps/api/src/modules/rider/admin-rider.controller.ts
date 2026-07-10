/**
 * Admin Rider Controller - W7-ext-D 骑手 CRUD
 *
 * 路由分组（/api/v1/admin/riders，仅 super_admin）：
 *   GET    /                         已审核骑手列表（status/keyword/warehouse 筛选）
 *   GET    /:id                       骑手详情（含最近 10 订单）
 *   PATCH  /:id                       编辑（vehicleType/plate/preferredWarehouseIds）
 *   POST   /:id/suspend               停用（User.status=SUSPENDED + RiderProfile=OFFLINE）
 *   POST   /:id/activate              恢复
 *   POST   /:id/delete                软删（User.status=DELETED）
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

const ListRidersQuery = z.object({
  status: z.enum(['OFFLINE', 'ONLINE', 'BUSY']).optional(),
  userStatus: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  keyword: z.string().max(50).optional(),
  warehouseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const UpdateRiderRequest = z.object({
  vehicleType: z.enum(['MOTORCYCLE', 'BICYCLE', 'CAR']).optional(),
  vehiclePlate: z.string().max(20).nullable().optional(),
  preferredWarehouseIds: z.array(z.string().uuid()).optional(),
});

const DeleteRiderRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

interface RequestWithUser {
  user?: RequestUser;
}

@Controller('api/v1/admin/riders')
@Roles('super_admin')
export class AdminRiderController {
  constructor(@Inject(RiderService) private readonly riderService: RiderService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(ListRidersQuery)) query: z.infer<typeof ListRidersQuery>) {
    const result = await this.riderService.adminListRiders({
      status: query.status,
      userStatus: query.userStatus,
      keyword: query.keyword,
      warehouseId: query.warehouseId,
      limit: query.limit,
    });
    return { success: true as const, data: result.items };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const data = await this.riderService.adminGetRiderDetail(id);
    return { success: true as const, data };
  }

  @Patch(':id')
  @Audit({ resource: 'RiderProfile', resourceIdParam: 'id' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRiderRequest)) body: z.infer<typeof UpdateRiderRequest>,
  ) {
    const data = await this.riderService.adminUpdateRider(id, body);
    return { success: true as const, data };
  }

  @Post(':id/suspend')
  @Audit({ resource: 'RiderProfile', resourceIdParam: 'id' })
  async suspend(@Param('id') id: string) {
    const data = await this.riderService.adminSuspendRider(id);
    return { success: true as const, data };
  }

  @Post(':id/activate')
  @Audit({ resource: 'RiderProfile', resourceIdParam: 'id' })
  async activate(@Param('id') id: string) {
    const data = await this.riderService.adminActivateRider(id);
    return { success: true as const, data };
  }

  @Post(':id/delete')
  @Audit({ resource: 'RiderProfile', resourceIdParam: 'id' })
  async delete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeleteRiderRequest)) _body: z.infer<typeof DeleteRiderRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const data = await this.riderService.adminDeleteRider(id, req.user.sub);
    return { success: true as const, data };
  }
}
