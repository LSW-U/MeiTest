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

/** 入驻申请 DTO */
export interface ApplyRiderInput {
  userId: string;
  riderName: string;
  phone: string;
  vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate?: string;
  idCardNumber: string;
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
  preferredWarehouseIds: string[];
  isOnline: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 骑手在线状态 Redis key TTL（60 秒，每次心跳续期） */
const RIDER_ONLINE_TTL_SEC = 60;

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

    return this.toView(updated, input.status !== 'OFFLINE');
  }

  /**
   * 心跳续期（骑手 WS 连接或定时 HTTP 上报时调）
   *
   * M4：仅 APPROVED 骑手心跳生效（PENDING/REJECTED 心跳返回 false 不污染在线列表）
   * 注意：每次心跳查 DB 会增加 QPS，可改成首次心跳查 DB + 后续只 SET Redis（依赖前端保证状态）
   */
  async heartbeat(riderId: string): Promise<{ renewed: boolean }> {
    const profile = await db.riderProfile.findUnique({
      where: { userId: riderId },
      select: { applicationStatus: true },
    });
    if (!profile || profile.applicationStatus !== 'APPROVED') {
      return { renewed: false };
    }
    try {
      await redis.set(this.onlineKey(riderId), '1', 'EX', RIDER_ONLINE_TTL_SEC);
      return { renewed: true };
    } catch (e) {
      logger.warn({
        msg: 'RIDER_HEARTBEAT_FAILED',
        riderId,
        error: (e as Error).message,
      });
      return { renewed: false };
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
    const isOnline = await this.isOnline(riderId);

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
      return this.toView({ ...profile, status: 'OFFLINE' as const }, false);
    }

    return this.toView(profile, isOnline);
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
      preferredWarehouseIds: string[];
      createdAt: Date;
      updatedAt: Date;
    },
    isOnline: boolean,
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
      preferredWarehouseIds: p.preferredWarehouseIds ?? [],
      isOnline,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
