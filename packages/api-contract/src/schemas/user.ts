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
import { ProductSummary } from './catalog';

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
  // 默认支付方式（方案乙批1 v3 20261022）：null=未设置；值域在 service 层 isPaymentMethodOrderable 校验
  defaultPaymentMethod: z.string().nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 修改个人资料请求 */
export const UpdateProfileRequest = z.object({
  name: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  // 默认支付方式（D4b）：zod 只放宽为 string（不挡枚举）——枚举内/enabled/available
  // 统一由 service 层 isPaymentMethodOrderable 判定并拒绝 400 E-USER-010（zod enum 会被
  // 共享 ZodValidationPipe 回成 E-COMMON-001）。null=清除偏好
  defaultPaymentMethod: z.string().nullable().optional(),
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
  /** 最近一次被下单使用时间（null = 从未使用，历史数据不回填） */
  lastUsedAt: IsoTimestamp.nullable(),
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
// 批A 2026-09-09：定义收敛到 schemas/notification.ts（扩 riderTasks/wallet），此处重导出保持兼容
// ============================================================================

export {
  NotificationPreferences,
  UpdateNotificationPreferencesRequest,
} from './notification';

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

/**
 * 收藏列表项（GET /client/favorites）
 * 批D P2-1 修正：此前 openapi 该端点 200 误用 FavoriteToggleResponse 占位，
 * 真实返回形状（数组 + 商品摘要）从未入契约，isCategoryTop3 无处声明
 */
export const FavoriteListItem = z.object({
  id: Id,
  productId: Id,
  product: ProductSummary,
  createdAt: IsoTimestamp,
});

/** 通知实体（批A 2026-09-09：type 扩 RIDER_TASK/WALLET，定义收敛到 schemas/notification.ts） */
export { NotificationItem, NotificationItemType } from './notification';

// ============================================================================
// 通知/推送管理（admin-web 优化方案 批次2 2026-08-29）
// 后台：POST /admin/notifications 发送 + GET /admin/notifications 发送历史
// 批A 2026-09-09：批次化 schema（历史批次行/AdminNotificationType/retry）收敛到 schemas/notification.ts
// ============================================================================

/** 通知投递目标 / 类型（批A 扩 RIDER_TASK/WALLET，定义收敛到 schemas/notification.ts 重导出） */
import { NotificationTarget, AdminNotificationType } from './notification';
export { NotificationTarget, AdminNotificationType };

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

/** 后台发送通知响应 data（批A A5 批次化：deliveredCount=首块同步落行数，批次行异步入队） */
export const AdminSendNotificationResponseData = z.object({
  /** 批次 id（NotificationBatch 行，历史/retry 定位用） */
  batchId: Id,
  /** 批次总收件人数（解析 target 后真实值） */
  totalRecipients: z.number().int().nonnegative(),
  /** 首块成功写入 Notification 表的条数（剩余分块异步入队） */
  deliveredCount: z.number().int().nonnegative(),
  /** PUSH 通道投递结果（mockFlag=true 表示未真实推送/降级 stub） */
  push: z.object({
    success: z.boolean(),
    mockFlag: z.boolean(),
    error: z.string().nullable(),
  }),
});

/**
 * 后台通知发送历史项（批A 2026-09-09 改批次行，定义收敛到 schemas/notification.ts 重导出）
 *
 * 历史 MVP 语义说明（已废弃，留档）：
 *   - P2-1 时代无 NotificationBatch 表，按 Notification 行倒序展示、deliveredCount=1 占位、不返 target。
 *   - 批A 建批次表后，历史项=批次行（deliveredCount=站内信落行数（审查 P3-1 统一口径）/failedCount/readCount 实时聚合/target）。
 */
export { AdminNotificationHistoryItem } from './notification';

/** 后台通知发送历史列表响应 data（offset 分页） */
export { AdminNotificationHistoryListResponseData } from './notification';

/** 后台通知发送历史 query（仅 type/page/pageSize） */
export { AdminListNotificationsQuery } from './notification';

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
  /** 全部收货地址（按 lastUsedAt desc nulls last → isDefault desc → createdAt desc） */
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

// ============================================================================
// 客户画像批1（2026-10-18）：单客 360 画像 + D6 客户标记（方案v2 §三 批1）
// ============================================================================

/** RFM 值（口径同源 R-a：COMPLETED+CANCELLED、不过滤 deletedAt，见 profile.service） */
export const ProfileRfm = z.object({
  /** 距最近一次购买天数（Dili 当地日历日差）；无购买 null */
  rDays: z.number().int().nonnegative().nullable(),
  /** 聚合基数订单数 */
  fCount: z.number().int().nonnegative(),
  /** 累计实付金额（分） */
  mTotal: z.number().int().nonnegative(),
  /** 最近一次购买时间；无购买 null */
  lastPurchaseAt: IsoTimestamp.nullable(),
  /** 首次购买时间；无购买 null */
  firstPurchaseAt: IsoTimestamp.nullable(),
});

/** 生命周期阶段（阈值可配 G5，判定顺序 NEW → FIRST_PURCHASE → CHURNED → SLEEPING → ACTIVE） */
export const LifecycleStage = z.enum(['NEW', 'FIRST_PURCHASE', 'ACTIVE', 'SLEEPING', 'CHURNED']);

/** 品类偏好分布项 */
export const ProfileCategoryPreferenceItem = z.object({
  categoryId: Id.nullable(),
  /** 多语言类目名切片（fallback en；无类目空串） */
  name: z.string(),
  freq: z.number().int().nonnegative(),
  /** 占总频次比例 0-1 */
  share: z.number().min(0).max(1),
});

/** 常用地址项（按订单配送快照聚合，非 Address 表） */
export const ProfileFrequentAddressItem = z.object({
  detail: z.string(),
  region: z.string(),
  freq: z.number().int().nonnegative(),
});

/** 订单史时间线项（近 20 单，含 CANCELLED——背调需要看见取消行为） */
export const ProfileTimelineItem = z.object({
  id: Id,
  orderNo: OrderNo,
  status: OrderStatus,
  payableAmount: z.number().int().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
  createdAt: IsoTimestamp,
});

/** 单客 360 画像响应 data（GET /admin/users/:id/profile） */
export const CustomerProfile360Data = z.object({
  rfm: ProfileRfm,
  lifecycle: z.object({ stage: LifecycleStage }),
  categoryPreferences: z.array(ProfileCategoryPreferenceItem),
  priceBand: z.object({
    min: z.number().int().nonnegative(),
    avg: z.number().min(0).nullable(),
    max: z.number().int().nonnegative(),
  }),
  discountSensitivity: z.object({
    discountOrderCount: z.number().int().nonnegative(),
    totalOrderCount: z.number().int().nonnegative(),
    /** 折扣订单占比 0-1；无订单 null */
    ratio: z.number().min(0).max(1).nullable(),
  }),
  peakHours: z.array(z.object({ hour: z.number().int().min(0).max(23), freq: z.number().int().nonnegative() })),
  frequentAddresses: z.array(ProfileFrequentAddressItem),
  timeline: z.array(ProfileTimelineItem),
  /** 批5 A7 并入：近 20 条搜索明细（洞察降级 null）；形状同 UserSearchLogItem（inline 展开——
   *  UserSearchLogItem 定义在本文件后部，此处内联避免引用未初始化常量的 TDZ 运行时错误） */
  searchHistory: z.array(z.object({
    id: Id,
    word: z.string(),
    lang: z.string(),
    resultCount: z.number().int().nonnegative(),
    createdAt: IsoTimestamp,
  })).nullable(),
  /** 批5 A8 并入：流失分 0-100 + 信号构成（洞察降级 null） */
  churn: z.object({
    score: z.number().min(0).max(100),
    parts: z.object({
      stage: z.string(),
      stageWeight: z.number(),
      recentViews: z.number().int().nonnegative(),
      viewWeight: z.number(),
      recentSearches: z.number().int().nonnegative(),
      searchWeight: z.number(),
    }),
  }).nullable(),
});

/** 客户标记项（D6） */
export const CustomerNoteItem = z.object({
  id: Id,
  userId: Id,
  /** 标记类型（自由标签，如 VIP / RISK / COMPLAINT） */
  type: z.string().min(1).max(30),
  content: z.string().min(1).max(500),
  createdBy: Id,
  createdAt: IsoTimestamp,
});

/** 新增标记请求（POST /admin/users/:id/notes） */
export const CreateCustomerNoteRequest = z.object({
  type: z.string().min(1).max(30),
  content: z.string().min(1).max(500),
});

/** 编辑标记请求（PATCH /admin/users/:id/notes/:noteId） */
export const UpdateCustomerNoteRequest = z.object({
  type: z.string().min(1).max(30).optional(),
  content: z.string().min(1).max(500).optional(),
});

/** 标记列表响应 data */
export const CustomerNoteListData = z.object({
  items: z.array(CustomerNoteItem),
});

// ============================================================================
// 客户画像批2（2026-10-18）：分层运营 D2/D3/D4/D7 + C5（方案v2 §三 批2 + 订正#7 + R-f）
// ============================================================================

/** D2 看板：单层聚合行（归层口径与单客 getLifecycleStage 同源，P2-1 对账一致） */
export const SegmentBucketRow = z.object({
  stage: LifecycleStage,
  userCount: z.number().int().nonnegative(),
  /** 该层累计实付（分） */
  gmvTotal: z.number().int().nonnegative(),
  /** GMV 占比 0-1（全层合计=1） */
  gmvShare: z.number().min(0).max(1),
});

/** D2 看板响应 data（GET /admin/marketing/segments/dashboard） */
export const SegmentDashboardData = z.object({
  totalUsers: z.number().int().nonnegative(),
  /** 有聚合基数订单（F≥1）的用户数 */
  purchasedUsers: z.number().int().nonnegative(),
  buckets: z.array(SegmentBucketRow),
  generatedAt: IsoTimestamp,
});

/** D3 共现项（买 X 还买 Y；share=共现订单数/目标商品订单数） */
export const CoPurchaseItem = z.object({
  productId: Id,
  name: z.string(),
  coOrderCount: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
});

/** D3 共现响应 data（GET /admin/marketing/segments/co-purchase） */
export const CoPurchaseData = z.object({
  product: z.object({ id: Id, name: z.string() }),
  /** 目标商品出现在多少订单（share 分母） */
  baseOrderCount: z.number().int().nonnegative(),
  items: z.array(CoPurchaseItem),
});

/** D3 分层回购率行 */
export const SegmentRepurchaseRow = z.object({
  stage: LifecycleStage,
  userCount: z.number().int().nonnegative(),
  /** 该层 F≥2 用户数 */
  repurchaseUserCount: z.number().int().nonnegative(),
  /** 回购率 0-1；层人数 0 时 null */
  repurchaseRate: z.number().min(0).max(1).nullable(),
});

/** D3 分层回购率响应 data */
export const SegmentRepurchaseData = z.object({
  stages: z.array(SegmentRepurchaseRow),
  generatedAt: IsoTimestamp,
});

/**
 * D4 券归因行（口径见端点描述 R2 精神）：
 *   claimed=持有该券人数；redeemed=USED 人数；redeemRate=redeemed/claimed；
 *   repurchaseOrders=领券用户 receivedAt 后 30 天内实付订单数（COMPLETED+CANCELLED）。
 */
export const CouponAttributionRow = z.object({
  stage: LifecycleStage,
  claimed: z.number().int().nonnegative(),
  redeemed: z.number().int().nonnegative(),
  redeemRate: z.number().min(0).max(1).nullable(),
  repurchaseOrders: z.number().int().nonnegative(),
  /** 该层全体人数（渗透率分母） */
  userCount: z.number().int().nonnegative(),
});

/** D4 券归因响应 data（GET /admin/marketing/segments/coupon-attribution/:promotionId） */
export const CouponAttributionData = z.object({
  promotionId: Id,
  rows: z.array(CouponAttributionRow),
});

/** D7 批量发券请求（POST /admin/marketing/segments/coupons/grant；上限对齐服务端硬顶 5000） */
export const BatchGrantCouponsRequest = z.object({
  promotionId: Id,
  userIds: z.array(Id).min(1).max(5000),
});

/** D7 批量发券响应 data（granted=新发 skipped=已持有幂等跳过 failed=配额满等） */
export const BatchGrantCouponsData = z.object({
  granted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/** C5 分层定向券规则项 */
export const SegmentCouponRuleItem = z.object({
  id: Id,
  stage: LifecycleStage,
  promotionId: Id,
  enabled: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** C5 规则列表响应 data */
export const SegmentCouponRuleListData = z.object({
  items: z.array(SegmentCouponRuleItem),
});

/** C5 新建规则请求 */
export const CreateSegmentCouponRuleRequest = z.object({
  stage: LifecycleStage,
  promotionId: Id,
  enabled: z.boolean().optional(),
});

/** C5 编辑规则请求 */
export const UpdateSegmentCouponRuleRequest = z.object({
  stage: LifecycleStage.optional(),
  promotionId: Id.optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// 客户画像批3（2026-10-18）：前台个性化体验 B8（方案v2 §三 批3）
// ============================================================================

/**
 * B8 常买组合一键购响应 data（GET /client/products/frequent-bundle）
 * 匿名 / 无历史 / 无共现 / seed 下架 → 空组合（items 空、seed null），前端整块隐藏
 */
export const FrequentBundleData = z.object({
  /** 用户最常买商品（组合主商品）；无则 null */
  seed: ProductSummary.nullable(),
  /** 与 seed 同单常共现的伙伴商品（共现订单数 desc，ACTIVE 过滤） */
  items: z.array(ProductSummary),
  /** 最强组合的共现订单数（seed 订单里同时含 top1 伙伴的订单数）；无组合 0 */
  coOrderCount: z.number().int().nonnegative(),
});

// ============================================================================
// 客户画像批4（2026-10-18）：B2 补货提醒手工订阅（方案v2 §三 批4）
// ============================================================================

/** B2 补货提醒订阅请求（POST /client/subscriptions；cycleDays 1-365 天） */
export const CreateSubscriptionRequest = z.object({
  productId: Id,
  /** 订阅类型（批5 扩展；缺省 REPLENISH 保持批4 语义） */
  type: z.enum(['REPLENISH', 'PRICE_ALERT', 'RESTOCK_ALERT']).optional(),
  /** 补货周期天数（REPLENISH 用；C7/C8 可省略） */
  cycleDays: z.number().int().min(1).max(365).optional(),
});

/** B2 订阅项 */
export const SubscriptionItem = z.object({
  id: Id,
  productId: Id,
  /** 订阅类型（REPLENISH 补货 / PRICE_ALERT 降价 / RESTOCK_ALERT 到货） */
  type: z.enum(['REPLENISH', 'PRICE_ALERT', 'RESTOCK_ALERT']),
  cycleDays: z.number().int().min(1).max(365),
  enabled: z.boolean(),
  lastRemindedAt: IsoTimestamp.nullable(),
  /** 降价订阅价格快照（分；仅 PRICE_ALERT） */
  priceAtSub: z.number().int().nonnegative().nullable().optional(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** B2 订阅列表响应 data（GET /client/subscriptions） */
export const SubscriptionListData = z.object({
  items: z.array(SubscriptionItem),
});

/** B2 修改订阅请求（PATCH /client/subscriptions/:id；启停或改周期） */
export const UpdateSubscriptionRequest = z.object({
  cycleDays: z.number().int().min(1).max(365).optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// 客户画像批6（2026-10-18）：协同过滤 A9（方案v2 §三 批6，E4 已拍板做）
// ============================================================================

/**
 * A9 和你相似的顾客还买了响应 data（GET /client/products/customers-also-bought）
 * 跨用户共现统计（物化 similar_user_picks）；匿名 / 无物化结果 / 候选全下架 → 空数组
 * （前端整块隐藏，勿用销量兜底——B1 教训）。只出商品不出人（P6-4：无邻居身份信息）。
 */
export const CustomersAlsoBoughtData = z.object({
  items: z.array(ProductSummary),
});

// ============================================================================
// 客户画像批5（2026-10-18）：行为埋点 + 洞察（方案v2 §三 批5）
// ============================================================================

/** 埋点事件项（POST /client/behavior-events 批内单条） */
export const BehaviorEventItem = z.object({
  productId: Id,
  /** VIEW 商品详情浏览 | SEARCH_CLICK 搜索结果点击 */
  type: z.enum(['VIEW', 'SEARCH_CLICK']),
  /** 客户端事件时间（可选，ISO；当前服务端以接收时间为准） */
  at: IsoTimestamp.optional(),
});

/** 埋点批量接收请求（≤100 条/批） */
export const BehaviorBatchRequest = z.object({
  events: z.array(BehaviorEventItem).min(1).max(100),
});

/** 埋点批量接收响应 data */
export const BehaviorBatchResponseData = z.object({
  accepted: z.number().int().nonnegative(),
});

/** D5 漏斗行（曝光=SearchLog / 点击=SEARCH_CLICK / 成交=聚合基数订单 三源对账） */
export const SearchFunnelRow = z.object({
  word: z.string(),
  searches: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  /** 点击率（无曝光 null） */
  ctr: z.number().min(0).max(1).nullable(),
  /** 点击→成交率（无点击 null） */
  conversion: z.number().min(0).nullable(),
});

/** D5 漏斗响应 data（GET /admin/marketing/behavior/search-funnel） */
export const SearchFunnelData = z.object({
  windowDays: z.number().int().min(1).max(90),
  rows: z.array(SearchFunnelRow),
  generatedAt: IsoTimestamp,
});

/** A7 per-user 搜索明细项（GET /admin/marketing/behavior/users/:id/searches） */
export const UserSearchLogItem = z.object({
  id: Id,
  word: z.string(),
  lang: z.string(),
  resultCount: z.number().int().nonnegative(),
  createdAt: IsoTimestamp,
});

/** A7 搜索明细响应 data */
export const UserSearchLogData = z.object({
  items: z.array(UserSearchLogItem),
});
