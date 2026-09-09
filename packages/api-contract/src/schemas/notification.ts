/**
 * 通知基础设施 schema（批A 2026-09-09：方案v2 §3.2）
 *
 * 覆盖：
 *   - DeviceToken 注册/注销（/client/device-tokens + /rider/device-tokens 双端点，body 同构）
 *   - 通知类型/批次化历史/retry 契约（A3/A5 批次化扩展同文件收敛，通知相关 schema 独立于 user.ts）
 *
 * 决策依据：方案v2-通知notification模块-20260909.md §3.1/§3.2
 *  - token 全局唯一（Expo PushToken），upsert by token 幂等（重注册更新 lastSeenAt+locale 不重复建行）
 *  - platform 枚举 ANDROID|IOS|WEB；locale 注册时快照（en 兜底）
 */
import { z } from 'zod';
import { Id, IsoTimestamp, I18nText } from './common';

// ============================================================================
// A3 NotificationItem（通知实体，从 user.ts 收敛至此；type 扩 RIDER_TASK/WALLET）
// ============================================================================

/** 站内信类型（批A 扩 RIDER_TASK/WALLET：rider 页四分类 task/order/wallet/system 与此映射） */
export const NotificationItemType = z.enum([
  'ORDER_UPDATE',
  'PROMOTION',
  'SYSTEM',
  'RIDER_TASK',
  'WALLET',
]);

/** 通知实体 */
export const NotificationItem = z.object({
  id: Id,
  userId: Id,
  type: NotificationItemType,
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

/** 通知偏好（GET 响应 / PATCH 返回全量；批A 扩 riderTasks/wallet 两键） */
export const NotificationPreferences = z.object({
  orderUpdates: z.boolean(),
  promotions: z.boolean(),
  system: z.boolean(),
  riderTasks: z.boolean().optional(),
  wallet: z.boolean().optional(),
});

/** 通知偏好部分更新请求（至少传一个 key） */
export const UpdateNotificationPreferencesRequest = z
  .object({
    orderUpdates: z.boolean().optional(),
    promotions: z.boolean().optional(),
    system: z.boolean().optional(),
    riderTasks: z.boolean().optional(),
    wallet: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.orderUpdates !== undefined ||
      v.promotions !== undefined ||
      v.system !== undefined ||
      v.riderTasks !== undefined ||
      v.wallet !== undefined,
    { message: 'at least one preference key is required' },
  );

// ============================================================================
// A1 DeviceToken（设备推送 token 注册/注销）
// ============================================================================

/** 设备平台枚举（Expo Push 三端） */
export const DeviceTokenPlatform = z.enum(['ANDROID', 'IOS', 'WEB']);

/** 设备 token 注册请求（client/rider 双端点 body 同构） */
export const RegisterDeviceTokenRequest = z.object({
  /** Expo PushToken（ExpoPushToken[...]），非空 */
  token: z.string().min(1).max(512),
  platform: DeviceTokenPlatform,
  /** 注册时 app 当前语言快照（en 兜底）→ 推送文案语言 */
  locale: z.enum(['en', 'zh', 'id', 'pt', 'tet']).default('en'),
});

/** 设备 token 注销请求（登出时按 token 删；DELETE body） */
export const DeleteDeviceTokenRequest = z.object({
  token: z.string().min(1).max(512),
});

/** 设备 token 注册响应 data（幂等 upsert 后的行视图） */
export const DeviceTokenItem = z.object({
  id: Id,
  platform: DeviceTokenPlatform,
  locale: z.string(),
  /** ACTIVE | INVALID（Expo 回执 NotRegistered 置 INVALID） */
  status: z.string(),
  lastSeenAt: IsoTimestamp,
});

// ============================================================================
// A5 NotificationBatch 批次化（admin 群发历史改批次行 + retry）
// ============================================================================

/** 通知投递目标（ALL_CUSTOMERS/ALL_RIDERS 全量群发，SPECIFIC_USERS 指定 userIds） */
export const NotificationTarget = z.enum(['ALL_CUSTOMERS', 'ALL_RIDERS', 'SPECIFIC_USERS']);

/**
 * 通知类型（批次表 type 列与 AdminNotificationHistoryItem.type 同源）。
 * 批A 扩 RIDER_TASK（骑手任务）/ WALLET（结算入账/提现结果）——admin 可定向 RIDER 群发任务/钱包通知。
 */
export const AdminNotificationType = z.enum([
  'ORDER_UPDATE',
  'PROMOTION',
  'SYSTEM',
  'RIDER_TASK',
  'WALLET',
]);

/**
 * 后台通知发送历史项（GET /admin/notifications 响应元素，批A 改**批次行**）
 *
 * 语义（方案v2 N4 + 审查 P3-1 口径统一 2026-09-09）：
 *   - 一行 = 一次 admin 群发批次（NotificationBatch 行）
 *   - deliveredCount = 站内信落行数（MVP 统一口径，同步可见；
 *     方案原「Expo 回执成功数」口径回执成本高暂不采用）
 *   - failedCount = 推送失败数（可 POST /:batchId/retry 重发）
 *   - readCount = 实时聚合 count(Notification where batchId AND isRead=true)，不落库
 */
export const AdminNotificationHistoryItem = z.object({
  id: Id,
  type: AdminNotificationType,
  /** 群发目标（批次表有 target：ALL_CUSTOMERS | ALL_RIDERS | SPECIFIC_USERS） */
  target: z.enum(['ALL_CUSTOMERS', 'ALL_RIDERS', 'SPECIFIC_USERS']),
  /** 批次收件人总数（=写表行数） */
  totalRecipients: z.number().int().nonnegative(),
  /** 站内信落行数（审查 P3-1 统一口径） */
  deliveredCount: z.number().int().nonnegative(),
  /** 推送失败数（retry 可重发） */
  failedCount: z.number().int().nonnegative(),
  /** 已读数（实时聚合，不落库） */
  readCount: z.number().int().nonnegative(),
  title: I18nText,
  content: I18nText,
  createdAt: IsoTimestamp,
});

/** 后台通知历史列表响应 data（offset 分页） */
export const AdminNotificationHistoryListResponseData = z.object({
  items: z.array(AdminNotificationHistoryItem),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

/** 后台通知发送历史 query（仅 type/page/pageSize——批次表后也不做 target 筛选，MVP 保持） */
export const AdminListNotificationsQuery = z.object({
  type: AdminNotificationType.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** 失败重试响应 data（仅重发 failed 用户，更新 delivered/failed） */
export const AdminRetryNotificationResponseData = z.object({
  batchId: Id,
  /** 本次重试实际重发的用户数（=当前 failedCount） */
  retriedCount: z.number().int().nonnegative(),
  deliveredCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  push: z.object({
    success: z.boolean(),
    mockFlag: z.boolean(),
    error: z.string().nullable(),
  }),
});
