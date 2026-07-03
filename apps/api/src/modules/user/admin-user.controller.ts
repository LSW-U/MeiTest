/**
 * Admin User Controller — 后台用户管理路由（W7 P1-2）
 *
 * 路由前缀 /api/v1/admin/users（deviceType=admin_web，role=super_admin）
 *
 * 端点：
 *   GET    /                列表（按 keyword/role/status 筛选 + 分页 + orderCount/totalSpent 聚合）
 *
 * 后台用户管理原本缺少列表接口，admin-web 用户管理页只能查 DB。
 * 现补一个分页查询接口，前端用户管理页直接调。
 */
import { Controller, Get, Query, Inject } from '@nestjs/common';
import { z } from 'zod';
import { UserService } from './user.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';

const ListUsersQuery = z.object({
  keyword: z.string().max(100).optional(),
  role: z
    .enum(['SUPER_ADMIN', 'CUSTOMER', 'RIDER', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE'])
    .optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
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
}
