/**
 * @Roles() 装饰器：声明端点允许的角色
 *
 * 用法：
 *   @Roles('super_admin')
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Get('admin-only')
 *
 *   @Roles('customer', 'rider')
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Get('any-user')
 */
import { SetMetadata } from '@nestjs/common';
import type { Role } from '@meimart/api-contract';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
