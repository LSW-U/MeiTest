/**
 * 用户资料模块 schema
 *
 * 决策依据：
 * - 契约 v0.2 §5.1 User 字段基准
 * - 契约 v0.3 决策 C：role 用 5 个真实角色（小写 snake_case）
 * - CLAUDE.md §多语言：name 等用 i18n，但 User.name 是昵称（单值），不进多语言
 */
import { z } from 'zod';
import { Id, IsoTimestamp, I18nText, Money } from './common';
import { Role } from './auth';
import { OrderNo, OrderStatus } from './order';

export const UserStatus = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);

/** 会员等级（B8，由 points 阈值实时算：≥5000 gold / ≥1000 silver / else bronze） */
export const MemberLevel = z.enum(['gold', 'silver', 'bronze']);

/** 用户实体（API 响应基准；phone 脱敏返回，例：770****234） */
export const User = z.object({
  id: Id,
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: Role,
  status: UserStatus,
  /** 会员等级（B8，实时算）。profile 返数值，其他场景可选 */
  memberLevel: MemberLevel.optional(),
  /** 会员积分（B8，$1=1pt，聚合已成交订单 payableAmount/100） */
  points: z.number().int().nonnegative().optional(),
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

// ============================================================================
// P17 B1 通知偏好（2026-08-17）：三分类开关（与 NotificationType 三值对应），null/缺省全 true
// ============================================================================

/** 通知偏好（GET 响应 / PATCH 返回全量） */
export const NotificationPreferences = z.object({
  /** ORDER_UPDATE 类通知开关 */
  orderUpdates: z.boolean(),
  /** PROMOTION 类通知开关 */
  promotions: z.boolean(),
  /** SYSTEM 类通知开关 */
  system: z.boolean(),
});

/** 通知偏好部分更新请求（至少传一个 key，未传的保持不变） */
export const UpdateNotificationPreferencesRequest = z
  .object({
    orderUpdates: z.boolean().optional(),
    promotions: z.boolean().optional(),
    system: z.boolean().optional(),
  })
  .refine(
    (v) => v.orderUpdates !== undefined || v.promotions !== undefined || v.system !== undefined,
    { message: 'at least one preference key is required' },
  );

// ============================================================================
// P17 B2.3 登录设备管理（2026-08-17）：Redis Token Family 只读聚合（不建表）
// ============================================================================

/** 登录会话项（GET /client/user/sessions；family 维度一条，最新登录在前） */
export const UserSession = z.object({
  /** refresh token family ID（DELETE /sessions/:familyId 用） */
  familyId: z.string(),
  deviceType: z.enum(['client_app', 'rider_app', 'admin_web']),
  /** active（在线）/ used（已轮换待刷新）/ revoked（已下线） */
  status: z.enum(['active', 'used', 'revoked']),
  createdAt: IsoTimestamp,
  expiresAt: IsoTimestamp,
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

// ============================================================================
// 通知/推送管理（admin-web 优化方案 批次2 2026-08-29）
// 后台：POST /admin/notifications 发送 + GET /admin/notifications 发送历史
// MVP 真链路 = 写 Notification 表 + 前端拉取；PUSH 走 dev stub（无 FCM/APNs/deviceToken）
// ============================================================================

/** 通知投递目标（ALL_CUSTOMERS/ALL_RIDERS 全量群发，SPECIFIC_USERS 指定 userIds） */
export const NotificationTarget = z.enum(['ALL_CUSTOMERS', 'ALL_RIDERS', 'SPECIFIC_USERS']);

/** 通知类型（与 NotificationItem.type 同源：ORDER_UPDATE/PROMOTION/SYSTEM） */
export const AdminNotificationType = z.enum(['ORDER_UPDATE', 'PROMOTION', 'SYSTEM']);

/** 后台发送通知请求（POST /admin/notifications body） */
export const AdminSendNotificationRequest = z
  .object({
    target: NotificationTarget,
    /** target=SPECIFIC_USERS 时必填，最多 1000 个（防误操作超大群发） */
    userIds: z.array(Id).max(1000).optional(),
    type: AdminNotificationType,
    /** 多语言标题（至少 en） */
    title: I18nText,
    /** 多语言正文（至少 en） */
    content: I18nText,
    /** 附加数据（如 orderId / promotionId），nullable */
    data: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((v) => v.target !== 'SPECIFIC_USERS' || (v.userIds ?? []).length > 0, {
    message: 'userIds is required and non-empty when target=SPECIFIC_USERS',
    path: ['userIds'],
  });

/** 后台发送通知响应 data（投递计数 + PUSH stub 结果，前端展示群发规模） */
export const AdminSendNotificationResponseData = z.object({
  /** 成功写入 Notification 表的条数（=实际投递用户数） */
  deliveredCount: z.number().int().nonnegative(),
  /** PUSH 通道投递结果（MVP dev stub，mockFlag=true 表示未真实推送） */
  push: z.object({
    success: z.boolean(),
    mockFlag: z.boolean(),
    error: z.string().nullable(),
  }),
});

/**
 * 后台通知发送历史项（GET /admin/notifications 响应元素）
 *
 * MVP 语义说明（2026-08-29 P2-1 修复）：
 *   - **不返 `target`**：MVP 无 NotificationBatch 表，单行 Notification 无法稳定反推群发目标，
 *     保留 target 字段会让前端误以为能按目标筛选/展示，实际后端拿不到真实值。
 *     真正按批次聚合（含 target/deliveredCount=批次规模）需建 NotificationBatch 表，列待办（方案 §四 暂缓增强）。
 *   - `deliveredCount` 是**单行近似值**（恒为 1）：历史按 Notification 行倒序展示，
 *     不代表「本次群发 N 人」的真实批次规模。前端展示需用文案说明「按条展示」非「按批次」。
 */
export const AdminNotificationHistoryItem = z.object({
  id: Id,
  type: AdminNotificationType,
  /**
   * 群发规模（写入条数，便于历史列表展示「本次群发 N 人」）。
   * MVP 无批次表，单行恒为 1（行数近似，非批次规模）——见上方语义说明。
   */
  deliveredCount: z.number().int().nonnegative(),
  title: I18nText,
  content: I18nText,
  createdAt: IsoTimestamp,
});

/** 后台通知发送历史列表响应 data（offset 分页） */
export const AdminNotificationHistoryListResponseData = z.object({
  items: z.array(AdminNotificationHistoryItem),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

/**
 * 后台通知发送历史 query
 *
 * MVP 仅支持 `type` 筛选（Notification.type 行级过滤）。
 * **不支持 `target` 筛选**：单行 Notification 不存 target，无法按目标过滤
 * （需 NotificationBatch 表，见 AdminNotificationHistoryItem 语义说明）。
 * 若未来加批次表后再补 target query 字段。
 */
export const AdminListNotificationsQuery = z.object({
  type: AdminNotificationType.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
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

// ===== W7-feature 客户管理详情/动作端点（2026-07-10 新增） =====

/** 订单摘要（客户详情 recentOrders 用，不含 items 数组减负） */
export const OrderSummary = z.object({
  id: Id,
  orderNo: OrderNo,
  status: OrderStatus,
  payableAmount: Money,
  createdAt: IsoTimestamp,
});

/** 后台用户详情（GET /:id 响应 data） */
export const AdminUserDetail = AdminUserListItem.extend({
  updatedAt: IsoTimestamp,
  /** 最近 5 笔已成交订单（按 createdAt desc） */
  recentOrders: z.array(OrderSummary).max(5),
  /** 全部收货地址（按 isDefault desc + createdAt desc） */
  addresses: z.array(Address),
});

/** 编辑客户资料请求（PATCH /:id body） */
export const UpdateAdminUserRequest = z.object({
  name: z.string().min(1).max(50).optional(),
  phone: z.string().min(5).max(20).optional(),
  email: z.string().email().nullable().optional(),
  avatarUrl: z.string().url().optional(),
  role: Role.optional(),
  phoneVerified: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
});

/** 暂停/激活请求 body（reason 可选，审计用） */
export const SuspendUserRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

export const ActivateUserRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

/** 删除请求 body（reason 可选，审计用） */
export const DeleteUserRequest = z.object({
  reason: z.string().min(1).max(200).optional(),
});

/** 重置密码响应 data（明文一次性返回） */
export const ResetPasswordResponseData = z.object({
  /** 12 字符 base64url 临时密码，明文不落库，仅本次响应返回 */
  temporaryPassword: z.string().length(12),
  generatedAt: IsoTimestamp,
});
