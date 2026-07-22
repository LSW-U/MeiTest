/**
 * User Module Controllers（W 流程 2026-06-24）
 *
 * 4 个 controller，全部在 /api/v1/client/* 前缀（customer 角色）：
 *   - UserController          /user/profile
 *   - AddressController       /addresses
 *   - FavoriteController      /favorites
 *   - NotificationController  /notifications
 *
 * Roles 策略：
 *   - 客户端接口 @Roles('CUSTOMER')（骑手 super_admin 走自己视角的 endpoint）
 *   - 后台查用户接口（如 admin/user-list）后续 M 流程做，本文件不写
 *
 * 三道全局 Guard（Jwt → DeviceType → Roles）已注册，controller 不写 @UseGuards
 */
import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Request,
  Query,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  UpdateProfileRequest,
  CreateAddressRequest,
  UpdateAddressRequest,
  FavoriteToggleRequest,
} from '@meimart/api-contract';
import { UserService } from './user.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

/** 用户资料 */
@Controller('api/v1/client/user')
@Roles('CUSTOMER')
export class UserController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get('profile')
  async getProfile(@Request() req: { user: RequestUser }) {
    const data = await this.users.getProfile(req.user.sub);
    return { success: true, data };
  }

  @Patch('profile')
  @Audit({ resource: 'User' })
  async updateProfile(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(UpdateProfileRequest)) body: { name?: string; avatarUrl?: string },
  ) {
    const data = await this.users.updateProfile(req.user.sub, body);
    return { success: true, data };
  }
}

/** 收货地址 */
@Controller('api/v1/client/addresses')
@Roles('CUSTOMER')
export class AddressController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get()
  async list(@Request() req: { user: RequestUser }) {
    const data = await this.users.listAddresses(req.user.sub);
    return { success: true, data };
  }

  @Post()
  @Audit({ resource: 'Address' })
  async create(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(CreateAddressRequest)) body: {
      name: string;
      phone: string;
      region: { province: string; city: string; district?: string };
      detail: string;
      lat?: number | null;
      lng?: number | null;
      isDefault?: boolean;
      tag?: string | null;
    },
  ) {
    const data = await this.users.createAddress(req.user.sub, body);
    return { success: true, data };
  }

  @Patch(':id')
  @Audit({ resource: 'Address' })
  async update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAddressRequest)) body: Partial<{
      name: string;
      phone: string;
      region: { province: string; city: string; district?: string };
      detail: string;
      lat: number | null;
      lng: number | null;
      isDefault: boolean;
      tag: string | null;
    }>,
  ) {
    const data = await this.users.updateAddress(req.user.sub, id, body);
    return { success: true, data };
  }

  @Delete(':id')
  @Audit({ resource: 'Address' })
  @HttpCode(HttpStatus.OK)
  async delete(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.users.deleteAddress(req.user.sub, id);
    return { success: true, data: null };
  }
}

/** 收藏 */
@Controller('api/v1/client/favorites')
@Roles('CUSTOMER')
export class FavoriteController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get()
  async list(@Request() req: { user: RequestUser }) {
    const data = await this.users.listFavorites(req.user.sub);
    return { success: true, data };
  }

  @Post('toggle')
  @Audit({ resource: 'Favorite' })
  @HttpCode(HttpStatus.OK)
  async toggle(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(FavoriteToggleRequest)) body: { productId: string },
  ) {
    const data = await this.users.toggleFavorite(req.user.sub, body.productId);
    return { success: true, data };
  }
}

/** 通知 */
@Controller('api/v1/client/notifications')
@Roles('CUSTOMER')
export class NotificationController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get()
  async list(
    @Request() req: { user: RequestUser },
    @Query('onlyUnread') onlyUnread?: string,
  ) {
    const data = await this.users.listNotifications(req.user.sub, onlyUnread === 'true');
    return { success: true, data };
  }

  @Get('unread-count')
  async unreadCount(@Request() req: { user: RequestUser }) {
    const data = await this.users.getUnreadCount(req.user.sub);
    return { success: true, data };
  }

  @Patch(':id/read')
  @Audit({ resource: 'Notification', skip: true })
  async markRead(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    const data = await this.users.markNotificationRead(req.user.sub, id);
    return { success: true, data };
  }

  @Post('read-all')
  @Audit({ resource: 'Notification', skip: true })
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Request() req: { user: RequestUser }) {
    const data = await this.users.markAllNotificationsRead(req.user.sub);
    return { success: true, data };
  }
}
