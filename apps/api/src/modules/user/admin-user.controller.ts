/**
 * Admin User Controller - 后台用户管理路由（W7 P1-2 列表 + W7-feature 2026-07-10 详情/动作）
 *
 * 路由前缀 /api/v1/admin/users（deviceType=admin_web，role=super_admin）
 *
 * 端点：
 *   GET    /                    列表（按 keyword/role/status 筛选 + 分页 + orderCount/totalSpent 聚合）
 *   GET    /:id                 详情（含最近 5 订单 + 全部地址）
 *   PATCH  /:id                 编辑资料（name/phone/email/avatarUrl/role/verified）
 *   POST   /:id/suspend         暂停（status -> SUSPENDED）
 *   POST   /:id/activate        激活（status -> ACTIVE，仅从 SUSPENDED）
 *   POST   /:id/reset-password  重置密码（返回 12 字符临时密码）
 *
 * 安全：
 *   - 不能暂停/降级自己（E-ADMIN-USER-005）
 *   - 不能暂停其他 super_admin（E-ADMIN-USER-004）
 *   - DELETED 是终态，不可激活/重置密码（E-ADMIN-USER-003）
 *   - 重置密码：明文一次性返回响应里，不落库，audit maskFields 不记
 */
import {
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Param,
  Body,
  Req,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { UserService } from './user.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

const ListUsersQuery = z.object({
  keyword: z.string().max(100).optional(),
  role: z
    .enum(['SUPER_ADMIN', 'CUSTOMER', 'RIDER', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE'])
    .optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const UpdateUserRequest = z.object({
  name: z.string().min(1).max(50).optional(),
  phone: z.string().min(5).max(20).optional(),
  email: z.string().email().nullable().optional(),
  avatarUrl: z.string().url().optional(),
  role: z
    .enum(['SUPER_ADMIN', 'CUSTOMER', 'RIDER', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE'])
    .optional(),
  phoneVerified: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
});

// W7-fix（审查 #9）：reason 仅作为审计上下文记录到 AuditLog.body，
// service 不消费（动作本身已由 audit decorator 记录），故 body 用 _ 前缀忽略
const SuspendUserRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

const ActivateUserRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

@Controller('api/v1/admin/users')
@Roles('super_admin')
export class AdminUserController {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  /** 列表（keyword/role/status 筛选 + 分页 + orderCount/totalSpent 聚合） */
  @Get()
  async list(@Query(new ZodValidationPipe(ListUsersQuery)) query: z.infer<typeof ListUsersQuery>) {
    const result = await this.users.listUsers({
      keyword: query.keyword,
      role: query.role,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { success: true as const, data: result };
  }

  /** GET /:id - 客户详情（含最近 5 订单 + 全部地址） */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const data = await this.users.getUserDetail(id);
    return { success: true as const, data };
  }

  /** PATCH /:id - 编辑客户资料 */
  @Patch(':id')
  @Audit({ resource: 'User', resourceIdParam: 'id' })
  async update(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserRequest)) body: z.infer<typeof UpdateUserRequest>,
  ) {
    const data = await this.users.updateUser(id, body, req.user.sub);
    return { success: true as const, data };
  }

  /** POST /:id/suspend - 暂停用户 */
  @Post(':id/suspend')
  @Audit({ resource: 'User', resourceIdParam: 'id' })
  async suspend(
    @Req() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SuspendUserRequest)) _body: z.infer<typeof SuspendUserRequest>,
  ) {
    const data = await this.users.suspendUser(id, req.user.sub);
    return { success: true as const, data };
  }

  /** POST /:id/activate - 激活用户（仅从 SUSPENDED） */
  @Post(':id/activate')
  @Audit({ resource: 'User', resourceIdParam: 'id' })
  async activate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ActivateUserRequest)) _body: z.infer<typeof ActivateUserRequest>,
  ) {
    const data = await this.users.activateUser(id);
    return { success: true as const, data };
  }

  /** POST /:id/reset-password - 重置密码（返回 12 字符临时密码，明文一次性返回） */
  @Post(':id/reset-password')
  @Audit({ resource: 'User', resourceIdParam: 'id', maskFields: ['temporaryPassword'] })
  async resetPassword(@Param('id') id: string) {
    const data = await this.users.resetUserPassword(id);
    return { success: true as const, data };
  }
}
