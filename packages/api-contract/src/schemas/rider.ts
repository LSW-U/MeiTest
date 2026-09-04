/**
 * 骑手模块 schema（骑手资料 + 在线状态 + 班次）
 *
 * 决策依据：
 * - schema.prisma 已有 RiderProfile 表
 * - W2 仅给骑手 App 骨架（登录/上下班），W3 接入 dispatch
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

/** 骑手状态（与 schema.prisma RiderStatus 同步） */
export const RiderStatus = z.enum(['OFFLINE', 'ONLINE', 'BUSY']);

/** 车辆类型 */
export const VehicleType = z.enum(['MOTORCYCLE', 'BICYCLE', 'CAR']);

/** 骑手等级（配送积分门槛：BRONZE 0+ / SILVER 100+ / GOLD 500+ / PLATINUM 2000+） */
export const RiderTier = z.enum(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);

/** 骑手申请状态 */
export const ApplicationStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

/** OSS 图片 URL（apply/update 通用，可选） */
const ImageUrl = z.string().url().max(2048).optional().nullable();

/** 骑手资料视图 */
export const RiderProfile = z.object({
  id: Id,
  userId: Id,
  riderName: z.string(),
  phone: z.string(),
  vehicleType: VehicleType,
  vehiclePlate: z.string().nullable(),
  status: RiderStatus,
  applicationStatus: ApplicationStatus,
  totalDeliveries: z.number().int().nonnegative(),
  rating: z.number().min(0).max(5),
  // W3 骑手个人区（2026-08-24）：证件/头像 URL + 配送积分/等级
  avatarUrl: z.string().url().nullable(),
  idCardImageUrl: z.string().url().nullable(),
  licenseImageUrl: z.string().url().nullable(),
  points: z.number().int().nonnegative(),
  tier: RiderTier,
  preferredWarehouseIds: z.array(Id),
  isOnline: z.boolean(),
  /**
   * 可能掉线标记（P6 #6，2026-08-25）
   * isOnline=true 且 Redis 在线 key 剩余 TTL ≤ 30s 宽限期时为 true；
   * 骑手 App 据此提示「网络重连中」，但仍计入可派列表（不立即踢出）。
   * 离线 / 正常在线（TTL>30s）均为 false。
   */
  maybeOffline: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /**
   * 批 E 审查 P1-2（2026-09-03）：admin 列表轻量冗余字段（口径与聚合详情一致）。
   * 注意：普通骑手端 getProfile 不返回这三字段（undefined），admin 列表才有——
   * 后端 toView 不含、adminListRiders 单独附加；契约上标记 optional 避免骑手端契约破坏。
   */
  depositAmount: z.number().int().nonnegative().optional(),
  /** 档位派生可接上限（分）；null = 不限；0 = 无资格（停用档回落） */
  maxOrderAmount: z.number().int().nonnegative().nullable().optional(),
  /** 今日完成单量 */
  todayDeliveries: z.number().int().nonnegative().optional(),
});

/** 入驻申请请求（common/rider/apply，apply payload 带 URL 方案） */
export const ApplyRiderRequest = z.object({
  riderName: z.string().min(1).max(50),
  phone: z.string().min(6).max(20),
  vehicleType: VehicleType.optional(),
  vehiclePlate: z.string().max(20).optional(),
  idCardNumber: z.string().min(6).max(30),
  avatarUrl: ImageUrl,
  idCardImageUrl: ImageUrl,
  licenseImageUrl: ImageUrl,
  preferredWarehouseIds: z.array(Id).optional(),
});

/**
 * 骑手自助改资料请求（rider/profile，PATCH）
 *
 * 不可改字段（F2 2026-08-24 审查报告）：
 *   - idCardNumber：换号=换人，应重新走 apply 审核
 *   - phone：换号涉及登录态 + SMS 验证 + 唯一性 + token revoke，应走 auth.changePhone，
 *     不在自助改资料范围（与 idCardNumber 同决策，避免无验证改号后门）
 */
export const UpdateRiderProfileRequest = z.object({
  riderName: z.string().min(1).max(50).optional(),
  vehicleType: VehicleType.optional(),
  vehiclePlate: z.string().max(20).nullable().optional(),
  avatarUrl: ImageUrl,
  idCardImageUrl: ImageUrl,
  licenseImageUrl: ImageUrl,
});

/** 接单模式（抢单 vs 系统派单） */
export const AcceptMode = z.enum(['GRAB', 'AUTO_DISPATCH']);

/** 切换上下班请求 */
export const UpdateDutyStatusRequest = z.object({
  status: RiderStatus,
  /** 上班时切换接单模式 */
  acceptMode: AcceptMode.optional(),
});

/** 骑手当前位置上报（WS 已有，HTTP 兜底用） */
export const ReportLocationRequest = z.object({
  lat: z.number(),
  lng: z.number(),
  speed: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  orderId: Id.optional(),
});

// ============================================================================
// 保证金（批 B，2026-09-02）—— 方案：保证金与派单体系 §三/§四
// ============================================================================

/** 缴纳通道：线上 mock（即时生效）/ 线下 COD（申请-确认流） */
export const RiderDepositChannel = z.enum(['ONLINE_MOCK', 'OFFLINE_COD']);

/** 缴存流水状态：PENDING → CONFIRMED / REJECTED；REJECTED 可重新提交；REFUNDED 仅 admin */
export const RiderDepositStatus = z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED']);

/** 保证金档位（admin 可编；上限由档位派生不落库） */
export const RiderDepositTier = z.object({
  id: Id,
  /** 最低保证金（分） */
  minAmount: z.number().int().positive(),
  /** 可接订单金额上限（分）；null = 不限 */
  maxOrderAmount: z.number().int().positive().nullable(),
  sortOrder: z.number().int(),
  enabled: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 缴纳点（admin 维护，COD 下拉选择） */
export const DepositLocation = z.object({
  id: Id,
  name: z.string(),
  address: z.string(),
  note: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 缴存流水（骑手端视图） */
export const RiderDepositRecord = z.object({
  id: Id,
  channel: RiderDepositChannel,
  /** 骑手申请额（分） */
  requestedAmount: z.number().int().positive(),
  /** admin 确认额（分）；PENDING 时为 null */
  confirmedAmount: z.number().int().positive().nullable(),
  status: RiderDepositStatus,
  locationId: Id.nullable(),
  note: z.string().nullable(),
  /** admin 备注（reject 必填 / confirm 可选），骑手端可见 */
  adminNote: z.string().nullable(),
  createdAt: IsoTimestamp,
  paidAt: IsoTimestamp.nullable(),
  confirmedAt: IsoTimestamp.nullable(),
});

/** 提交缴纳申请请求（POST /rider/deposit/requests） */
export const CreateRiderDepositRequest = z.object({
  channel: RiderDepositChannel,
  /** 金额（分，≥100 即 $1） */
  amount: z.number().int().min(100),
  /** 线下缴纳点（OFFLINE_COD 必填且 enabled=true） */
  locationId: Id.optional(),
  /** 骑手说明（COD 场景写联系方式/备注等） */
  note: z.string().max(500).optional(),
});

/** pay-mock 响应（ONLINE_MOCK 即时确认后） */
export const RiderDepositPayMockResult = z.object({
  deposit: RiderDepositRecord,
  /** 累加后的保证金总额（分） */
  depositAmount: z.number().int().nonnegative(),
});

/** GET /rider/deposit/status 响应 */
export const RiderDepositStatusResponse = z.object({
  /** 生效保证金总额（分） */
  depositAmount: z.number().int().nonnegative(),
  /** 命中档位（depositAmount ≥ minAmount 的最高档）；null = 未命中任何档（未缴） */
  tier: RiderDepositTier.nullable(),
  /** 最近 10 条申请（含状态/adminNote） */
  recentRequests: z.array(RiderDepositRecord),
});

// ============================================================================
// 保证金骑手端只读两端点（补端点批，2026-09-03）—— COD 下拉 / 档位提示
// ============================================================================

/** 骑手端缴纳点行（字段收窄：不含 enabled/timestamps——admin 维护骑手只读） */
export const RiderDepositLocationItem = z.object({
  id: Id,
  name: z.string(),
  address: z.string(),
  note: z.string().nullable(),
});

/** GET /rider/deposit/locations 响应（enabled=true 列表） */
export const RiderDepositLocationListResponse = z.array(RiderDepositLocationItem);

// ============================================================================
// 保证金 admin 侧（批 C，2026-09-02）—— 方案 §四 admin 端点 + Q8 聚合详情
// ============================================================================

/** admin 档位编辑请求（POST/PATCH 通用；maxOrderAmount null=不限，需 > minAmount） */
export const AdminUpsertTierRequest = z
  .object({
    minAmount: z.number().int().positive(),
    maxOrderAmount: z.number().int().positive().nullable(),
    sortOrder: z.number().int().min(0),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.maxOrderAmount === null || v.maxOrderAmount > v.minAmount, {
    message: 'maxOrderAmount must be greater than minAmount (or null for unlimited)',
    path: ['maxOrderAmount'],
  });

/** admin 档位局部编辑（PATCH 全字段可选，但校验规则同上） */
export const AdminUpdateTierRequest = z
  .object({
    minAmount: z.number().int().positive().optional(),
    maxOrderAmount: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.maxOrderAmount === undefined ||
      v.maxOrderAmount === null ||
      v.minAmount === undefined ||
      v.maxOrderAmount > v.minAmount,
    { message: 'maxOrderAmount must be greater than minAmount (or null)', path: ['maxOrderAmount'] },
  );

/** admin 缴纳点编辑请求 */
export const AdminUpsertLocationRequest = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1).max(300),
  note: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});

/** admin 申请列表行（含骑手姓名/手机号 + 缴纳点名称） */
export const AdminDepositRequestItem = RiderDepositRecord.extend({
  riderName: z.string(),
  riderPhone: z.string(),
  locationName: z.string().nullable(),
});

/** admin 申请列表查询 */
export const AdminListDepositRequestsQuery = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'REFUNDED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** admin 申请列表响应 */
export const AdminDepositRequestListResponse = z.object({
  items: z.array(AdminDepositRequestItem),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

/** admin confirm 请求 */
export const AdminConfirmDepositRequest = z.object({
  /** 实收金额（分，可修正）；缺省 = requestedAmount */
  confirmedAmount: z.number().int().min(100).optional(),
  adminNote: z.string().max(500).optional(),
});

/** admin reject 请求（adminNote 必填） */
export const AdminRejectDepositRequest = z.object({
  adminNote: z.string().min(1).max(500),
});

/** 骑手聚合详情（Q8 ①–⑤，批 C） */
export const AdminRiderDepositDetail = z.object({
  /** ① 基础资料 */
  basic: z.object({
    riderProfileId: Id,
    userId: Id,
    riderName: z.string(),
    phone: z.string(),
    vehicleType: VehicleType,
    vehiclePlate: z.string().nullable(),
    applicationStatus: ApplicationStatus,
    preferredWarehouseIds: z.array(Id),
  }),
  /** ② 实时状态 */
  realtime: z.object({
    status: RiderStatus,
    isOnline: z.boolean(),
    maybeOffline: z.boolean(),
    /** 在途任务数（ASSIGNED/PICKED_UP/DELIVERING） */
    activeTaskCount: z.number().int().nonnegative(),
  }),
  /** ③ 业务统计 */
  stats: z.object({
    todayDeliveries: z.number().int().nonnegative(),
    totalDeliveries: z.number().int().nonnegative(),
    rating: z.number().min(0).max(5),
  }),
  /** ④ 财务（depositAmount / 命中档位 / 上限 / 结算余额） */
  finance: z.object({
    depositAmount: z.number().int().nonnegative(),
    tier: RiderDepositTier.nullable(),
    maxOrderAmount: z.number().int().positive().nullable(),
    /** 结算余额（分）= 各 Settlement netAmount 汇总 − 已 PAID 提现（MVP 近似值） */
    settleBalance: z.number().int(),
  }),
  /** ⑤ 缴存申请列表（最近 20 条） */
  depositRequests: z.array(AdminDepositRequestItem),
});

/** 各仓负载（批 C #7） */
export const WarehouseLoadItem = z.object({
  warehouseId: Id,
  warehouseCode: z.string(),
  warehouseName: z.string().nullable(),
  /** 待派单任务数（PENDING_ASSIGN） */
  pendingTaskCount: z.number().int().nonnegative(),
  /** 可用骑手数（APPROVED + Redis 在线 + 工作仓含该仓） */
  availableRiderCount: z.number().int().nonnegative(),
  /** 预计等待分钟（pendingTaskCount / max(availableRiderCount,1) × 30min 近似） */
  estWaitMinutes: z.number().int().nonnegative(),
});

// ============================================================================
// 派单候选（批 D，2026-09-03）—— 方案 Q10 两段式 + Q13 资格标签
// ============================================================================

/** 资格标签（✅可接 / ⛔需保证金 $Z） */
export const DispatchEligibilityLabel = z.object({
  eligible: z.boolean(),
  depositAmount: z.number().int().nonnegative(),
  maxOrderAmount: z.number().int().positive().nullable(),
  /** 不合格时：接到该单所需最低保证金（分） */
  requiredDeposit: z.number().int().nonnegative().optional(),
});

/** 派单候选行 */
export const DispatchCandidate = z.object({
  riderProfileId: Id,
  riderName: z.string(),
  phone: z.string(),
  vehicleType: VehicleType,
  isOnline: z.boolean(),
  rating: z.number().min(0).max(5),
  depositAmount: z.number().int().nonnegative(),
  /** 档位上限（分）；null = 不限；0 = 无资格 */
  maxOrderAmount: z.number().int().nonnegative().nullable(),
  inTransitTasks: z.number().int().nonnegative(),
  /** 距取货点距离（km）；null = 无实时位置 */
  distanceKm: z.number().nullable(),
  eligibility: DispatchEligibilityLabel,
  /** 工作仓是否含任务仓（跨仓支援时 false 候选也可见） */
  warehouseMatched: z.boolean(),
  /** 排序得分（0-100，高在前；平局 depositAmount 高优先） */
  score: z.number().int(),
});

/** 派单候选响应 */
export const DispatchCandidateList = z.object({
  taskId: Id,
  orderAmount: z.number().int().nonnegative(),
  items: z.array(DispatchCandidate),
});
