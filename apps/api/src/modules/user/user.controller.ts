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
  NotFoundException,
} from '@nestjs/common';
import {
  UpdateProfileRequest,
  CreateAddressRequest,
  UpdateAddressRequest,
  FavoriteToggleRequest,
  UpdateNotificationPreferencesRequest,
} from '@meimart/api-contract';
import { UserService } from './user.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';
import { listUserSessions, revokeFamily } from '../../shared/cache';

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

  /** P17 B1（2026-08-17）：通知偏好（GET 全量三布尔，null 兜底全 true） */
  @Get('notification-preferences')
  async getNotificationPreferences(@Request() req: { user: RequestUser }) {
    const data = await this.users.getNotificationPreferences(req.user.sub);
    return { success: true, data };
  }

  /** P17 B1：通知偏好部分更新（至少传一个 key，返回更新后全量；列表/未读数按偏好过滤） */
  @Patch('notification-preferences')
  @Audit({ resource: 'User' })
  async updateNotificationPreferences(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesRequest))
    body: { orderUpdates?: boolean; promotions?: boolean; system?: boolean },
  ) {
    const data = await this.users.updateNotificationPreferences(req.user.sub, body);
    return { success: true, data };
  }

  /**
   * P17 B2.3（2026-08-17）：登录设备列表（Redis Token Family 只读聚合）
   * family 维度一条（同 family refresh 轮换合并），最新登录在前
   */
  @Get('sessions')
  async listSessions(@Request() req: { user: RequestUser }) {
    const sessions = await listUserSessions(req.user.sub);
    const data = sessions.map((s) => ({
      familyId: s.familyId,
      deviceType: s.deviceType,
      status: s.status,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
    }));
    return { success: true, data };
  }

  /** P17 B2.3：下线指定设备（按 familyId 撤销整族 refresh token） */
  @Delete('sessions/:familyId')
  @Audit({ resource: 'User' })
  async revokeSession(
    @Request() req: { user: RequestUser },
    @Param('familyId') familyId: string,
  ) {
    // 归属校验：该 family 必须属于当前用户（防撤他人会话）
    const sessions = await listUserSessions(req.user.sub);
    if (!sessions.some((s) => s.familyId === familyId)) {
      throw new NotFoundException({ code: 'E-USER-007', message: 'Session not found' });
    }
    await revokeFamily(familyId);
    return { success: true, data: null };
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
