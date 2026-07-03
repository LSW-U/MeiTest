/**
 * 用户资料模块 schema
 *
 * 决策依据：
 * - 契约 v0.2 §5.1 User 字段基准
 * - 契约 v0.3 决策 C：role 用 5 个真实角色（小写 snake_case）
 * - CLAUDE.md §多语言：name 等用 i18n，但 User.name 是昵称（单值），不进多语言
 */
import { z } from 'zod';
import { Id, IsoTimestamp, I18nText } from './common';
import { Role } from './auth';

export const UserStatus = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);

/** 用户实体（API 响应基准；phone 脱敏返回，例：770****234） */
export const User = z.object({
  id: Id,
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: Role,
  status: UserStatus,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 修改个人资料请求 */
export const UpdateProfileRequest = z.object({
  name: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
});

/** 修改密码请求 */
export const ChangePasswordRequest = z.object({
  oldPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/[a-zA-Z]/)
    .regex(/\d/),
});

// ============================================================================
// W 流程扩展（2026-06-24）：Address / Favorite / Notification
// ============================================================================

/** 地址多语言区域 JSON：{ province, city, district } 三级，前端 MeiMart1.0 sync-api 后适配 */
export const AddressRegion = z.object({
  province: z.string(),
  city: z.string(),
  district: z.string().optional(),
});

/** 地址实体 */
export const Address = z.object({
  id: Id,
  userId: Id,
  name: z.string(),
  phone: z.string(),
  region: AddressRegion,
  detail: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isDefault: z.boolean(),
  tag: z.string().nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 创建地址请求 */
export const CreateAddressRequest = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  region: AddressRegion,
  detail: z.string().min(1),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  isDefault: z.boolean().optional(),
  tag: z.string().nullable().optional(),
});

/** 修改地址请求（全字段 optional） */
export const UpdateAddressRequest = CreateAddressRequest.partial();

/** 切换默认地址请求 */
export const SetDefaultAddressRequest = z.object({
  isDefault: z.literal(true),
});

/** 收藏切换请求 */
export const FavoriteToggleRequest = z.object({
  productId: Id,
});

/** 收藏切换响应 */
export const FavoriteToggleResponse = z.object({
  isFavorite: z.boolean(),
});

/** 通知实体 */
export const NotificationItem = z.object({
  id: Id,
  userId: Id,
  type: z.enum(['ORDER_UPDATE', 'PROMOTION', 'SYSTEM']),
  title: I18nText,
  content: I18nText,
  isRead: z.boolean(),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoTimestamp,
});

/** 通知标记已读响应 */
export const MarkNotificationReadResponse = z.object({
  success: z.boolean(),
});

/** 后台用户列表项（W7 P1-2） */
export const AdminUserListItem = z.object({
  id: Id,
  phone: z.string(),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: Role,
  status: UserStatus,
  phoneVerified: z.boolean(),
  emailVerified: z.boolean(),
  lastLoginAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  /** 订单数（不含 CANCELLED） */
  orderCount: z.number().int().nonnegative(),
  /** 已成交订单 payableAmount 总和（DELIVERED_PAID + COMPLETED，单位：分） */
  totalSpent: z.number().int().nonnegative(),
});

/** 后台用户列表响应 data */
export const AdminUserListResponseData = z.object({
  items: z.array(AdminUserListItem),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

/** 后台用户列表 query */
export const ListUsersQuery = z.object({
  keyword: z.string().max(100).optional(),
  role: z.enum(['SUPER_ADMIN', 'CUSTOMER', 'RIDER', 'WAREHOUSE_STAFF', 'CUSTOMER_SERVICE']).optional(),
  status: UserStatus.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
