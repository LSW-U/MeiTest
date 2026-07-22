/**
 * 客户管理共享常量
 *
 * 列表页 + 详情页共用，避免动态拼接 i18n key（审查 #6）
 *
 * W7-fix（审查 #11）：UserRole / UserStatus 派生自 @meimart/shared-types 的 OpenAPI schema，
 * 避免手写 enum 与后端契约脱钩
 */
import type { components } from '@meimart/shared-types';

type Schemas = components['schemas'];

export type UserRole = Schemas['AdminUserListItem']['role'];
export type UserStatus = Schemas['AdminUserListItem']['status'];

/** role -> i18n key 映射（避免动态拼接字符串 key） */
export const ROLE_LABEL_KEY: Record<UserRole, string> = {
  SUPER_ADMIN: 'admin.customers.roleSuperAdmin',
  CUSTOMER: 'admin.customers.roleCustomer',
  RIDER: 'admin.customers.roleRider',
  WAREHOUSE_STAFF: 'admin.customers.roleWarehouseStaff',
  CUSTOMER_SERVICE: 'admin.customers.roleCustomerService',
};
