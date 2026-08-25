/**
 * Rider Service — 骑手入驻 + 上下班 + 接单模式
 *
 * 决策依据：
 * - 契约 v0.3：单一商家多仓库，骑手可绑偏好仓库
 * - W-M-C-T 任务分解 W3 M3 C1/C2
 * - migration `add_rider_application_c`：applicationStatus / idCardNumber / preferredWarehouseIds
 *
 * 业务流程：
 *   1. 入驻申请：用户 POST /apply，创建 RiderProfile(applicationStatus=PENDING)
 *   2. 平台审核：admin POST /admin/rider-applications/:id/review（APPROVED/REJECTED）
 *   3. 上下班：APPROVED 后骑手 PATCH /duty，status=OFFLINE↔ONLINE
 *   4. 接单模式：PATCH /duty 传 acceptMode=GRAB / AUTO_DISPATCH（W3 仅 GRAB 实做）
 *
 * 在线状态（WS 心跳）：
 *   - RealtimeGateway 已在 connect 时把 rider 加入 'riders' room
 *   - 在线状态用 Redis 维护：`rider:online:{riderId}` → 1，TTL 60s，每次心跳续期
 *   - 离线时 DEL（或 TTL 过期）
 *
 * W3 暂不做：
 *   - 实名认证三方对接（mock：只存 idCardNumber，不验真）
 *   - 班次管理（W4+）
 */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';

/** 骑手申请状态 */
export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** 接单模式 */
export type AcceptMode = 'GRAB' | 'AUTO_DISPATCH';

/** 骑手等级（配送积分门槛：BRONZE 0+ / SILVER 100+ / GOLD 500+ / PLATINUM 2000+） */
export type RiderTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

/** 等级门槛（每完成 1 单 +10 分，故门槛 = 单数 × 10） */
const TIER_THRESHOLDS: Array<{ tier: RiderTier; min: number }> = [
  { tier: 'PLATINUM', min: 2000 },
  { tier: 'GOLD', min: 500 },
  { tier: 'SILVER', min: 100 },
  { tier: 'BRONZE', min: 0 },
];

/** 每完成 1 单增加的配送积分 */
export const POINTS_PER_DELIVERY = 10;

/** 按积分计算等级（取第一个满足门槛的，数组已按门槛降序） */
export function calcTier(points: number): RiderTier {
  for (const { tier, min } of TIER_THRESHOLDS) {
    if (points >= min) return tier;
  }
  return 'BRONZE';
}

/**
 * 对 profile 视图做 tier 派生校正（F5/F6 2026-08-24 审查报告）
 *
 * - tier 是 points 的纯派生量（calcTier(points)），DB.tier 由 deliverTask 写积分时同步写准（见 dispatch.service）
 * - 此处仍按 points 重算一次返回值做兜底防御：若 DB.tier 因历史脏值/旧路径滞后，view.tier 以 calcTier 为准
 * - 不再 fire-and-forget 回写 DB（消除 getProfile 写放大 + 两条端点 tier 不一致），写时算准即够
 */
function withDerivedTier(view: RiderProfileView): RiderProfileView {
  const expected = calcTier(view.points);
  if (view.tier !== expected) {
    view.tier = expected;
  }
  return view;
}

/** 入驻申请 DTO */
export interface ApplyRiderInput {
  userId: string;
  riderName: string;
  phone: string;
  vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate?: string;
  idCardNumber: string;
  avatarUrl?: string;
  idCardImageUrl?: string;
  licenseImageUrl?: string;
  preferredWarehouseIds?: string[];
}

/** 审核结果 */
export interface ReviewInput {
  applicationId: string;
  reviewerId: string;
  decision: 'APPROVED' | 'REJECTED';
  rejectReason?: string;
}

/** 上下班切换 */
export interface UpdateDutyInput {
  riderId: string;
  status: 'OFFLINE' | 'ONLINE' | 'BUSY';
  acceptMode?: AcceptMode;
}

/**
 * 骑手自助改资料 DTO
 *
 * 不可改字段（F2 2026-08-24 审查报告）：
 *   - idCardNumber：换号=换人，应重新走 apply 审核
 *   - phone：换号涉及登录态 + SMS 验证 + 唯一性 + token revoke，应走 auth.changePhone
 */
export interface UpdateRiderProfileInput {
  riderId: string;
  riderName?: string;
  vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate?: string | null;
  avatarUrl?: string | null;
  idCardImageUrl?: string | null;
  licenseImageUrl?: string | null;
}

/** 骑手 profile 视图（API 返回） */
export interface RiderProfileView {
  id: string;
  userId: string;
  riderName: string;
  phone: string;
  vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate: string | null;
  status: 'OFFLINE' | 'ONLINE' | 'BUSY';
  applicationStatus: ApplicationStatus;
  totalDeliveries: number;
  rating: number;
  avatarUrl: string | null;
  idCardImageUrl: string | null;
  licenseImageUrl: string | null;
  points: number;
  tier: RiderTier;
  preferredWarehouseIds: string[];
  isOnline: boolean;
  /**
   * 可能掉线标记（P6 #6，2026-08-25）
   * 仅当 isOnline=true 且 TTL≤30s 宽限期时为 true；离线 / 正常在线均为 false。
   */
  maybeOffline: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 骑手在线状态 Redis key TTL（60 秒，每次心跳续期） */
const RIDER_ONLINE_TTL_SEC = 60;
/**
 * 心跳宽限阈值（P6 #6，2026-08-25）
 *
 * 剩余 TTL ≤ 此阈值视为「可能掉线」（maybeOffline）：
 *   - 正常心跳每 < 30s 续期一次，TTL 始终 > 30s → maybeOffline=false
 *   - 心跳延迟 / 网络抖动：TTL 跌入 (0, 30] 区间 → maybeOffline=true（骑手 App 提示「重连中」，但仍计入可派列表）
 *   - TTL 归零：彻底离线，从可派列表移除（listAvailableRiders EXISTS=0）
 *
 * 设计：单 key + TTL 读，不引入第二 key；listAvailableRiders 仍用 EXISTS（宽限期内可见）。
 */
const RIDER_ONLINE_GRACE_THRESHOLD_SEC = 30;

@Injectable()
export class RiderService {
  /** Redis key：rider:online:{riderId} → "1"，TTL 60s */
  private onlineKey(riderId: string): string {
    return `rider:online:${riderId}`;
  }

  /**
   * 骑手入驻申请
   *
   * - 同 userId 已有 RiderProfile → 抛 E-RIDER-002
   * - 创建 RiderProfile(applicationStatus=PENDING, status=OFFLINE)
   */
  async apply(input: ApplyRiderInput): Promise<RiderProfileView> {
    const existing = await db.riderProfile.findUnique({ where: { userId: input.userId } });
    if (existing) {
      throw new ConflictException({
        code: 'E-RIDER-002',
        message: 'Rider profile already exists (cannot apply twice)',
      });
    }

    if (!input.idCardNumber || input.idCardNumber.length < 6) {
      throw new ConflictException({
        code: 'E-RIDER-003',
        message: 'idCardNumber required (min 6 chars, mock verification)',
      });
    }

    const profile = await db.riderProfile.create({
      data: {
        userId: input.userId,
        riderName: input.riderName,
        phone: input.phone,
        vehicleType: input.vehicleType ?? 'MOTORCYCLE',
        vehiclePlate: input.vehiclePlate,
        applicationStatus: 'PENDING',
        idCardNumber: input.idCardNumber,
        avatarUrl: input.avatarUrl,
        idCardImageUrl: input.idCardImageUrl,
        licenseImageUrl: input.licenseImageUrl,
        preferredWarehouseIds: input.preferredWarehouseIds ?? [],
      },
    });

    logger.info({
      msg: 'RIDER_APPLICATION_SUBMITTED',
      riderId: profile.id,
      userId: input.userId,
      riderName: input.riderName,
    });

    return this.toView(profile, false);
  }

  /**
   * 平台审核（admin 调）
   */
  async review(input: ReviewInput): Promise<RiderProfileView> {
    const profile = await db.riderProfile.findUnique({ where: { id: input.applicationId } });
    if (!profile) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Rider application not found',
      });
    }

    if (profile.applicationStatus !== 'PENDING') {
      throw new ConflictException({
        code: 'E-RIDER-004',
        message: `Application already ${profile.applicationStatus}`,
      });
    }

    if (input.decision === 'REJECTED' && !input.rejectReason) {
      throw new ConflictException({
        code: 'E-RIDER-005',
        message: 'rejectReason required when rejecting',
      });
    }

    const updated = await db.riderProfile.update({
      where: { id: input.applicationId },
      data: {
        applicationStatus: input.decision,
        reviewedById: input.reviewerId,
        reviewedAt: new Date(),
        rejectReason:
          input.decision === 'REJECTED'
            ? input.rejectReason
            : profile.rejectReason,
      },
    });

    // 审核通过时更新 User.role 为 RIDER（否则重登后 role 还是 CUSTOMER，调 /rider/* 会 403）
    if (input.decision === 'APPROVED') {
      await db.user.update({
        where: { id: profile.userId },
        data: { role: 'RIDER' },
      });
    }

    logger.info({
      msg: 'RIDER_APPLICATION_REVIEWED',
      applicationId: input.applicationId,
      reviewerId: input.reviewerId,
      decision: input.decision,
    });

    return this.toView(updated, false);
  }

  /**
   * 切换上下班 / 接单模式
   *
   * - 仅 APPROVED 骑手可上线（status OFFLINE → ONLINE）
   * - 上线时 Redis SET rider:online:{riderId} TTL 60s
   * - 下线时 DEL rider:online:{riderId}
   * - 接单模式存 Redis（runtime 状态，DB 不存）
   */
  async updateDuty(input: UpdateDutyInput): Promise<RiderProfileView> {
    const profile = await db.riderProfile.findUnique({ where: { userId: input.riderId } });
    if (!profile) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Rider profile not found (please apply first)',
      });
    }

    if (profile.applicationStatus !== 'APPROVED') {
      throw new ConflictException({
        code: 'E-RIDER-006',
        message: `Rider not approved (current: ${profile.applicationStatus})`,
      });
    }

    const updated = await db.riderProfile.update({
      where: { userId: input.riderId },
      data: { status: input.status },
    });

    if (input.status === 'ONLINE' || input.status === 'BUSY') {
      try {
        await redis.set(this.onlineKey(input.riderId), '1', 'EX', RIDER_ONLINE_TTL_SEC);
      } catch (e) {
        logger.warn({
          msg: 'RIDER_ONLINE_SET_FAILED',
          riderId: input.riderId,
          error: (e as Error).message,
        });
      }
    } else {
      try {
        await redis.del(this.onlineKey(input.riderId));
      } catch (e) {
        logger.warn({
          msg: 'RIDER_ONLINE_DEL_FAILED',
          riderId: input.riderId,
          error: (e as Error).message,
        });
      }
    }

    if (input.acceptMode) {
      try {
        await redis.set(
          `rider:accept-mode:${input.riderId}`,
          input.acceptMode,
          'EX',
          24 * 60 * 60,
        );
      } catch (e) {
        logger.warn({
          msg: 'RIDER_ACCEPT_MODE_SET_FAILED',
          riderId: input.riderId,
          error: (e as Error).message,
        });
      }
    }

    logger.info({
      msg: 'RIDER_DUTY_UPDATED',
      riderId: input.riderId,
      status: input.status,
      acceptMode: input.acceptMode,
    });

    // P1-2 修复（2026-08-25）：updateDuty 已 SET/DEL Redis 在线 key，
    //   ONLINE/BUSY 分支刚 SETEX TTL=60s > 宽限阈值 30s → maybeOffline=false（与 heartbeat 对称）；
    //   OFFLINE 分支已 DEL → isOnline=false → maybeOffline=false。无需再查 TTL。
    return this.toView(updated, input.status !== 'OFFLINE');
  }

  /**
   * 心跳续期（骑手 WS 连接或定时 HTTP 上报时调）
   *
   * M4：仅 APPROVED 骑手心跳生效（PENDING/REJECTED 心跳返回 false 不污染在线列表）
   * 注意：每次心跳查 DB 会增加 QPS，可改成首次心跳查 DB + 后续只 SET Redis（依赖前端保证状态）
   *
   * P6 #6（2026-08-25）：返回 maybeOffline=false（刚续期，TTL 重置为 60s，远离宽限阈值）
   */
  async heartbeat(riderId: string): Promise<{ renewed: boolean; maybeOffline: boolean }> {
    const profile = await db.riderProfile.findUnique({
      where: { userId: riderId },
      select: { applicationStatus: true },
    });
    if (!profile || profile.applicationStatus !== 'APPROVED') {
      return { renewed: false, maybeOffline: false };
    }
    try {
      await redis.set(this.onlineKey(riderId), '1', 'EX', RIDER_ONLINE_TTL_SEC);
      // 刚 SETEX，TTL=60s > 宽限阈值 30s，不在宽限期
      return { renewed: true, maybeOffline: false };
    } catch (e) {
      logger.warn({
        msg: 'RIDER_HEARTBEAT_FAILED',
        riderId,
        error: (e as Error).message,
      });
      return { renewed: false, maybeOffline: false };
    }
  }

  /** 查询骑手 profile */
  async getProfile(riderId: string): Promise<RiderProfileView> {
    const profile = await db.riderProfile.findUnique({ where: { userId: riderId } });
    if (!profile) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Rider profile not found',
      });
    }

    // P2-6 修复（2026-08-25）：单次 redis.ttl 同时推 isOnline + maybeOffline，
    //   不再先 EXISTS 再 TTL（两次 Redis 往返）。
    //   TTL 语义：>30 在线且健康 / 0..30 在线但宽限 / <0 离线（-2 不存在 / -1 无过期异常）。
    //   isMaybeOffline 内部本就调 getOnlineTtl，此处复用同一 TTL，避免重复往返。
    const ttl = await this.getOnlineTtl(riderId);
    const isOnline = ttl > 0 || ttl === -1; // ttl>0 在线；-1 无过期视为在线（异常但不误判离线）
    const maybeOffline = isOnline ? ttl >= 0 && ttl <= RIDER_ONLINE_GRACE_THRESHOLD_SEC : false;

    // S6 / V2-S3 修复：DB status 与 Redis isOnline 不一致时
    //   - 客户端视角：以 Redis 为准（强制返回 OFFLINE）
    //   - admin 视角：异步 UPDATE DB 修正（不阻塞响应，失败仅 warn）
    if ((profile.status === 'ONLINE' || profile.status === 'BUSY') && !isOnline) {
      db.riderProfile
        .update({
          where: { userId: riderId },
          data: { status: 'OFFLINE' },
        })
        .catch((e) => {
          logger.warn({
            msg: 'RIDER_STATUS_RECONCILE_FAILED',
            riderId,
            error: (e as Error).message,
          });
        });
      // F5 修复（2026-08-24 审查报告）：tier 改为派生校正返回，不再 fire-and-forget 回写 DB
      return withDerivedTier(this.toView({ ...profile, status: 'OFFLINE' as const }, false));
    }

    // F5 修复（2026-08-24 审查报告）：tier 是 points 的纯派生量，deliverTask 写积分时已同步写 DB.tier；
    //   查询路径只读不写，用 calcTier 兜底校正返回值（防御历史脏值/旧滞后），消除写放大 + 竞态
    return withDerivedTier(this.toView(profile, isOnline, maybeOffline));
  }

  /**
   * 骑手自助改资料（W3 骑手个人区，2026-08-24）
   *
   * - idCardNumber 不可改（换号应重新走 apply 审核）
   * - 仅 APPROVED 骑手可改（PENDING/REJECTED 拒绝）
   * - 改 vehiclePlate 传 null/空串 → 置 null（与 adminUpdateRider 一致）
   * - 改 URL 字段传 null → 置 null（清除证件图）
   */
  async updateProfile(input: UpdateRiderProfileInput): Promise<RiderProfileView> {
    const profile = await db.riderProfile.findUnique({ where: { userId: input.riderId } });
    if (!profile) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Rider profile not found (please apply first)',
      });
    }

    if (profile.applicationStatus !== 'APPROVED') {
      throw new ConflictException({
        code: 'E-RIDER-006',
        message: `Rider not approved (current: ${profile.applicationStatus})`,
      });
    }

    const data: {
      riderName?: string;
      vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
      vehiclePlate?: string | null;
      avatarUrl?: string | null;
      idCardImageUrl?: string | null;
      licenseImageUrl?: string | null;
    } = {};
    if (input.riderName !== undefined) data.riderName = input.riderName;
    if (input.vehicleType !== undefined) data.vehicleType = input.vehicleType;
    if (input.vehiclePlate !== undefined) {
      data.vehiclePlate = input.vehiclePlate === null || input.vehiclePlate.trim() === '' ? null : input.vehiclePlate.trim();
    }
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;
    if (input.idCardImageUrl !== undefined) data.idCardImageUrl = input.idCardImageUrl;
    if (input.licenseImageUrl !== undefined) data.licenseImageUrl = input.licenseImageUrl;

    if (Object.keys(data).length === 0) {
      const isOnline = await this.isOnline(profile.userId);
      // P1-2 修复（2026-08-25）：空补丁路径对在线骑手补查 maybeOffline，与 getProfile 对称
      const maybeOffline = isOnline ? await this.isMaybeOffline(profile.userId) : false;
      // F6 修复（2026-08-24 审查报告）：空补丁早返回也要 calcTier 兜底，与 getProfile 对称
      return withDerivedTier(this.toView(profile, isOnline, maybeOffline));
    }

    const updated = await db.riderProfile.update({
      where: { userId: input.riderId },
      data,
    });

    logger.info({
      msg: 'RIDER_PROFILE_UPDATED',
      riderId: input.riderId,
      fields: Object.keys(data),
    });

    const isOnline = await this.isOnline(updated.userId);
    // P1-2 修复（2026-08-25）：非空补丁路径对在线骑手补查 maybeOffline，与 getProfile 对称
    const maybeOffline = isOnline ? await this.isMaybeOffline(updated.userId) : false;
    // F6 修复（2026-08-24 审查报告）：非空补丁路径同样 calcTier 兜底
    return withDerivedTier(this.toView(updated, isOnline, maybeOffline));
  }

  /** 列出待审核申请（admin 用） */
  async listPendingApplications(options: {
    status?: ApplicationStatus;
    limit?: number;
  }): Promise<{ items: RiderProfileView[] }> {
    const limit = Math.min(options.limit ?? 50, 100);
    const profiles = await db.riderProfile.findMany({
      where: options.status ? { applicationStatus: options.status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      items: profiles.map((p) => this.toView(p, false)),
    };
  }

  /** 检查骑手是否在线（Redis SETEX 后 60s 内视为在线） */
  async isOnline(riderId: string): Promise<boolean> {
    try {
      const exists = await redis.exists(this.onlineKey(riderId));
      return exists > 0;
    } catch {
      return false;
    }
  }

  /**
   * 取在线 key 剩余 TTL（秒，P6 #6 宽限机制 2026-08-25）
   *
   * @returns TTL 秒数；-2=key 不存在（彻底离线）；-1=key 无过期时间（异常，视为在线）
   */
  async getOnlineTtl(riderId: string): Promise<number> {
    try {
      return await redis.ttl(this.onlineKey(riderId));
    } catch {
      return -2;
    }
  }

  /**
   * 骑手是否处于「可能掉线」宽限期（P6 #6，2026-08-25）
   *
   * 宽限期：0 < TTL ≤ RIDER_ONLINE_GRACE_THRESHOLD_SEC（30s）
   *   - TTL=0：刚续期后理论上不存在；查询瞬间 TTL 恰为 0 视为宽限（极短窗口）
   *   - TTL≤30：心跳延迟，骑手 App 提示重连，但仍计入可派列表
   *   - TTL<0（不存在 / 无过期）：不在宽限期（前者已离线，后者异常在线）
   */
  async isMaybeOffline(riderId: string): Promise<boolean> {
    const ttl = await this.getOnlineTtl(riderId);
    return ttl >= 0 && ttl <= RIDER_ONLINE_GRACE_THRESHOLD_SEC;
  }

  // ========================================================================
  // W7-ext-D：admin 骑手 CRUD（6 端点）
  // ========================================================================

  /** Admin 列出已审核骑手（applicationStatus=APPROVED） */
  async adminListRiders(options: {
    status?: 'OFFLINE' | 'ONLINE' | 'BUSY';
    keyword?: string;
    warehouseId?: string;
    userStatus?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    limit?: number;
  }): Promise<{ items: RiderProfileView[] }> {
    const limit = Math.min(options.limit ?? 50, 100);
    const where: {
      applicationStatus: string;
      status?: 'OFFLINE' | 'ONLINE' | 'BUSY';
      OR?: Array<{ riderName?: { contains: string }; phone?: { contains: string } }>;
      preferredWarehouseIds?: { has: string };
      user?: { status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED' };
    } = { applicationStatus: 'APPROVED' };

    if (options.status) where.status = options.status;
    if (options.warehouseId) where.preferredWarehouseIds = { has: options.warehouseId };
    if (options.userStatus) where.user = { status: options.userStatus };
    if (options.keyword) {
      where.OR = [
        { riderName: { contains: options.keyword } },
        { phone: { contains: options.keyword } },
      ];
    }

    const profiles = await db.riderProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // P1-2 修复（2026-08-25）：admin 列表对在线骑手补查 maybeOffline，管理员能看到谁在宽限期
    // 批量并发查 TTL，避免串行 N 次往返；离线骑手 maybeOffline=false 不查
    const withOnline = await Promise.all(
      profiles.map(async (p) => {
        const isOnline = await this.isOnline(p.userId);
        const maybeOffline = isOnline ? await this.isMaybeOffline(p.userId) : false;
        return this.toView(p, isOnline, maybeOffline);
      }),
    );

    return {
      items: withOnline,
    };
  }

  /** Admin 查询骑手详情（含 User 状态 + 最近 10 订单 + 统计） */
  async adminGetRiderDetail(id: string): Promise<RiderProfileView & {
    userStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
    idCardNumber: string | null;
    reviewedById: string | null;
    reviewedAt: string | null;
    rejectReason: string | null;
    recentOrders: Array<{
      id: string;
      orderNo: string;
      status: string;
      payableAmount: number;
      createdAt: string;
    }>;
  }> {
    const profile = await db.riderProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, status: true, phone: true } },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            orderNo: true,
            status: true,
            payableAmount: true,
            createdAt: true,
          },
        },
      },
    });
    if (!profile) {
      throw new NotFoundException({ code: 'E-RIDER-001', message: 'Rider profile not found' });
    }

    const isOnline = await this.isOnline(profile.userId);
    // P1-2 修复（2026-08-25）：admin 详情对在线骑手补查 maybeOffline，与 getProfile 对称
    const maybeOffline = isOnline ? await this.isMaybeOffline(profile.userId) : false;
    const base = this.toView(profile, isOnline, maybeOffline);
    return {
      ...base,
      userStatus: profile.user.status,
      idCardNumber: profile.idCardNumber,
      reviewedById: profile.reviewedById,
      reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
      rejectReason: profile.rejectReason,
      recentOrders: profile.orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        payableAmount: o.payableAmount,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  /** Admin 编辑骑手（仅 vehicle 信息 + 偏好仓库，不改 status） */
  async adminUpdateRider(
    id: string,
    input: {
      vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
      vehiclePlate?: string | null;
      preferredWarehouseIds?: string[];
    },
  ): Promise<RiderProfileView> {
    const profile = await db.riderProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException({ code: 'E-RIDER-001', message: 'Rider profile not found' });
    }
    const data: {
      vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
      vehiclePlate?: string | null;
      preferredWarehouseIds?: string[];
    } = {};
    if (input.vehicleType) data.vehicleType = input.vehicleType;
    if (input.vehiclePlate !== undefined) {
      data.vehiclePlate = input.vehiclePlate === null || input.vehiclePlate.trim() === '' ? null : input.vehiclePlate.trim();
    }
    if (input.preferredWarehouseIds !== undefined) {
      data.preferredWarehouseIds = input.preferredWarehouseIds;
    }
    if (Object.keys(data).length === 0) {
      const isOnline = await this.isOnline(profile.userId);
      // P1-2 修复（2026-08-25）：空补丁对在线骑手补查 maybeOffline
      const maybeOffline = isOnline ? await this.isMaybeOffline(profile.userId) : false;
      return this.toView(profile, isOnline, maybeOffline);
    }
    const updated = await db.riderProfile.update({ where: { id }, data });
    const isOnline = await this.isOnline(updated.userId);
    // P1-2 修复（2026-08-25）：非空补丁对在线骑手补查 maybeOffline
    const maybeOffline = isOnline ? await this.isMaybeOffline(updated.userId) : false;
    return this.toView(updated, isOnline, maybeOffline);
  }

  /** Admin 停用骑手（User.status=SUSPENDED + RiderProfile.status=OFFLINE） */
  async adminSuspendRider(id: string): Promise<{ id: string; userStatus: string; riderStatus: string }> {
    const profile = await db.riderProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException({ code: 'E-RIDER-001', message: 'Rider profile not found' });
    }
    const user = await db.user.findUnique({ where: { id: profile.userId } });
    if (!user) {
      throw new NotFoundException({ code: 'E-AUTH-001', message: 'User not found' });
    }
    if (user.status === 'SUSPENDED') {
      throw new ConflictException({ code: 'E-RIDER-002', message: 'Rider already suspended' });
    }

    await db.user.update({ where: { id: profile.userId }, data: { status: 'SUSPENDED' } });
    await db.riderProfile.update({ where: { id }, data: { status: 'OFFLINE' } });

    // 清除 Redis 在线状态，dispatch 拒接单
    try {
      await redis.del(this.onlineKey(profile.userId));
    } catch {
      // 忽略 Redis 错误
    }

    logger.info({ msg: 'RIDER_ADMIN_SUSPENDED', riderId: id, userId: profile.userId });
    return { id, userStatus: 'SUSPENDED', riderStatus: 'OFFLINE' };
  }

  /** Admin 恢复骑手（User.status=ACTIVE，骑手自行 PATCH /duty 上班） */
  async adminActivateRider(id: string): Promise<{ id: string; userStatus: string }> {
    const profile = await db.riderProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException({ code: 'E-RIDER-001', message: 'Rider profile not found' });
    }
    const user = await db.user.findUnique({ where: { id: profile.userId } });
    if (!user) {
      throw new NotFoundException({ code: 'E-AUTH-001', message: 'User not found' });
    }
    if (user.status === 'ACTIVE') {
      throw new ConflictException({ code: 'E-RIDER-003', message: 'Rider already active' });
    }
    if (user.status === 'DELETED') {
      throw new ConflictException({ code: 'E-RIDER-004', message: 'Cannot activate deleted rider' });
    }

    await db.user.update({ where: { id: profile.userId }, data: { status: 'ACTIVE' } });
    logger.info({ msg: 'RIDER_ADMIN_ACTIVATED', riderId: id, userId: profile.userId });
    return { id, userStatus: 'ACTIVE' };
  }

  /** Admin 软删骑手（User.status=DELETED + RiderProfile.status=OFFLINE） */
  async adminDeleteRider(id: string, actorId: string): Promise<{ id: string; userStatus: string }> {
    const profile = await db.riderProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException({ code: 'E-RIDER-001', message: 'Rider profile not found' });
    }
    if (id === actorId || profile.userId === actorId) {
      throw new ConflictException({ code: 'E-RIDER-005', message: 'Cannot delete yourself' });
    }
    const user = await db.user.findUnique({ where: { id: profile.userId } });
    if (!user) {
      throw new NotFoundException({ code: 'E-AUTH-001', message: 'User not found' });
    }
    if (user.status === 'DELETED') {
      throw new ConflictException({ code: 'E-RIDER-006', message: 'Rider already deleted' });
    }

    await db.user.update({ where: { id: profile.userId }, data: { status: 'DELETED' } });
    await db.riderProfile.update({ where: { id }, data: { status: 'OFFLINE' } });

    try {
      await redis.del(this.onlineKey(profile.userId));
    } catch {
      // 忽略
    }

    logger.info({ msg: 'RIDER_ADMIN_DELETED', riderId: id, userId: profile.userId, actorId });
    return { id, userStatus: 'DELETED' };
  }

  /** 转换为 API 视图 */
  private toView(
    p: {
      id: string;
      userId: string;
      riderName: string;
      phone: string;
      vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
      vehiclePlate: string | null;
      status: 'OFFLINE' | 'ONLINE' | 'BUSY';
      applicationStatus: string; // V2-S6 修复：schema 改 NOT NULL，去掉 | null
      totalDeliveries: number;
      rating: { toNumber(): number };
      avatarUrl: string | null;
      idCardImageUrl: string | null;
      licenseImageUrl: string | null;
      points: number;
      tier: string;
      preferredWarehouseIds: string[];
      createdAt: Date;
      updatedAt: Date;
    },
    isOnline: boolean,
    maybeOffline = false,
  ): RiderProfileView {
    return {
      id: p.id,
      userId: p.userId,
      riderName: p.riderName,
      phone: p.phone,
      vehicleType: p.vehicleType,
      vehiclePlate: p.vehiclePlate,
      status: p.status,
      // V2-S6 修复：NOT NULL 后无需 ?? 兜底
      applicationStatus: p.applicationStatus as ApplicationStatus,
      totalDeliveries: p.totalDeliveries,
      rating: typeof p.rating === 'number' ? p.rating : p.rating?.toNumber() ?? 5,
      avatarUrl: p.avatarUrl,
      idCardImageUrl: p.idCardImageUrl,
      licenseImageUrl: p.licenseImageUrl,
      points: p.points,
      // F3 修复（2026-08-24 审查报告）：DB 已加 CHECK 约束（migration 20260824141706），
      //   此处再做运行时 narrowing 兜底（防御历史脏值/直连 DB 写入），非法值降级 BRONZE 而非裸断言通过
      tier: ((): RiderTier => {
        const t = p.tier as string;
        return t === 'BRONZE' || t === 'SILVER' || t === 'GOLD' || t === 'PLATINUM'
          ? (t as RiderTier)
          : 'BRONZE';
      })(),
      preferredWarehouseIds: p.preferredWarehouseIds ?? [],
      isOnline,
      // P6 #6（2026-08-25）：maybeOffline 由调用方按 TTL 宽限期决定；默认 false（离线/普通在线）
      maybeOffline: isOnline ? maybeOffline : false,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
