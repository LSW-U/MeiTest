/**
 * Me Controller（测试用，返回当前 JWT user 信息）
 *
 * 路径：/api/v1/admin/me, /api/v1/client/me, /api/v1/rider/me
 *
 * 用途：D4-T7 e2e 验证 JwtAuthGuard + DeviceTypeGuard + RolesGuard 三道闸门
 *
 * W2 替换：
 *   - /api/v1/admin/me → modules/profile/profile.controller.ts AdminProfileController（后台用户资料）
 *   - /api/v1/client/me → modules/profile/profile.controller.ts ClientProfileController（客户端用户资料）
 *   - /api/v1/rider/me → modules/rider/rider.controller.ts RiderController.profile（骑手资料）
 * 替换后此文件删除。
 */
import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { DeviceTypeGuard } from '../../shared/guards/device-type.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

@UseGuards(JwtAuthGuard, DeviceTypeGuard, RolesGuard)
@Controller('api/v1')
export class MeController {
  @Get('admin/me')
  @Roles('super_admin', 'customer_service', 'warehouse_staff')
  adminMe(@Request() req: { user: RequestUser }) {
    return { success: true, data: { user: req.user, scope: 'admin' } };
  }

  @Get('client/me')
  @Roles('customer')
  clientMe(@Request() req: { user: RequestUser }) {
    return { success: true, data: { user: req.user, scope: 'client' } };
  }

  @Get('rider/me')
  @Roles('rider')
  riderMe(@Request() req: { user: RequestUser }) {
    return { success: true, data: { user: req.user, scope: 'rider' } };
  }
}
