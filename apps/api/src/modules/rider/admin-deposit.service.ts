/**
 * AdminDeposit Service — admin 侧保证金（批 C，2026-09-02）
 *
 * 方案：Obsidian 保证金与派单体系方案/02-CC任务书-后端接口.md 批 C
 *   1. tiers CRUD（DELETE = 软停用；改档不动 rider.depositAmount，上限派生自动生效）
 *   2. locations CRUD（DELETE = 软停用）
 *   3. requests 列表（status 过滤 + 分页，含骑手姓名/手机号/缴纳点名）
 *   4. confirm（事务：CONFIRMED + confirmedAt + depositAmount 原子累加；重复 confirm 拒绝）
 *   5. reject（adminNote 必填；REJECTED 后骑手可重提）
 *   6. riders/:id/detail 聚合（Q8 ①-⑤）
 *   7. dispatch/warehouse-load（各仓负载面板）
 *
 * 错误码（admin 段 101+，与骑手段 001-007 区分）：
 *   101 minAmount 撞已有档（P2002）
 *   102 档位不存在
 *   103 缴纳点不存在
 *   104 非 PENDING 状态（confirm/reject 幂等拒绝）
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../../shared/db';
import { withTransaction } from '../../shared/db';
import { redis } from '../../shared/cache';
import { DepositEligibilityService } from './deposit-eligibility.service';

/** DTO：档位编辑（POST 全量 / PATCH 局部） */
export interface TierUpsertInput {
  minAmount?: number;
  maxOrderAmount?: number | null;
  sortOrder?: number;
  enabled?: boolean;
}

export interface LocationUpsertInput {
  name?: string;
  address?: string;
  note?: string | null;
  enabled?: boolean;
}

/** 列表行（契约 AdminDepositRequestItem） */
export interface AdminDepositRequestItemView {
  id: string;
  channel: 'ONLINE_MOCK' | 'OFFLINE_COD';
  requestedAmount: number;
  confirmedAmount: number | null;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED';
  locationId: string | null;
  note: string | null;
  adminNote: string | null;
  createdAt: Date;
  paidAt: Date | null;
  confirmedAt: Date | null;
  riderName: string;
  riderPhone: string;
  locationName: string | null;
}

/** DB 流水（含关联）→ 列表行视图 */
type DepositWithJoins = {
  id: string;
  channel: 'ONLINE_MOCK' | 'OFFLINE_COD';
  requestedAmount: number;
  confirmedAmount: number | null;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED';
  locationId: string | null;
  note: string | null;
  adminNote: string | null;
  createdAt: Date;
  paidAt: Date | null;
  confirmedAt: Date | null;
  rider?: { riderName: string; phone: string } | null;
  location?: { name: string } | null;
};

function toItemView(d: DepositWithJoins): AdminDepositRequestItemView {
  return {
    id: d.id,
    channel: d.channel,
    requestedAmount: d.requestedAmount,
    confirmedAmount: d.confirmedAmount,
    status: d.status,
    locationId: d.locationId,
    note: d.note,
    adminNote: d.adminNote,
    createdAt: d.createdAt,
    paidAt: d.paidAt,
    confirmedAt: d.confirmedAt,
    riderName: d.rider?.riderName ?? '',
    riderPhone: d.rider?.phone ?? '',
    locationName: d.location?.name ?? null,
  };
}

@Injectable()
export class AdminDepositService {
  constructor(
    // 批D审查 P3-1（2026-09-03 裁决）：tier CRUD 成功后清档位缓存，
    // 「停用档立即回落」单进程实时生效（60s 缓存不再吃旧档）
    @Inject(DepositEligibilityService) private readonly eligibility: DepositEligibilityService,
  ) {}

  // ===== 1. tiers CRUD =====

  /** 档位列表（sortOrder 升序，含停用档供 admin 查看） */
  async listTiers() {
    return db.riderDepositTier.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /**
   * 新增档位。校验：minAmount>0 / maxOrderAmount null 或 > minAmount / minAmount 唯一。
   * 方案核心：改档位不动任何 rider.depositAmount（上限 = 派生查询，实时生效）。
   */
  async createTier(input: { minAmount: number; maxOrderAmount: number | null; sortOrder: number; enabled?: boolean }) {
    if (input.maxOrderAmount !== null && input.maxOrderAmount <= input.minAmount) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: `maxOrderAmount (${input.maxOrderAmount}) must be greater than minAmount (${input.minAmount}) or null`,
      });
    }
    try {
      const tier = await db.riderDepositTier.create({
        data: {
          minAmount: input.minAmount,
          maxOrderAmount: input.maxOrderAmount,
          sortOrder: input.sortOrder,
          enabled: input.enabled ?? true,
        },
      });
      this.eligibility.clearTierCache(); // P3-1：新档立即参与派生
      return tier;
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        throw new ConflictException({
          code: 'E-DEPOSIT-101',
          message: `Tier with minAmount=${input.minAmount} already exists`,
        });
      }
      throw e;
    }
  }

  /** 编辑档位（局部；上限变化实时生效——派生查询无回填） */
  async updateTier(id: string, input: TierUpsertInput) {
    const existing = await db.riderDepositTier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-DEPOSIT-102', message: `Tier not found (${id})` });
    }
    // 合并后校验 maxOrderAmount > minAmount（或 null）
    const minAmount = input.minAmount ?? existing.minAmount;
    const maxOrderAmount = input.maxOrderAmount === undefined ? existing.maxOrderAmount : input.maxOrderAmount;
    if (maxOrderAmount !== null && maxOrderAmount <= minAmount) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: `maxOrderAmount (${maxOrderAmount}) must be greater than minAmount (${minAmount}) or null`,
      });
    }
    try {
      const tier = await db.riderDepositTier.update({ where: { id }, data: input });
      this.eligibility.clearTierCache(); // P3-1：改档/启停立即生效
      return tier;
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        throw new ConflictException({
          code: 'E-DEPOSIT-101',
          message: `Tier with minAmount=${minAmount} already exists`,
        });
      }
      throw e;
    }
  }

  /** 删除档位 = 软停用（enabled=false，保留历史定义） */
  async deleteTier(id: string) {
    const existing = await db.riderDepositTier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-DEPOSIT-102', message: `Tier not found (${id})` });
    }
    await db.riderDepositTier.update({ where: { id }, data: { enabled: false } });
    this.eligibility.clearTierCache(); // P3-1：停用档立即回落（不再吃 60s 旧缓存）
    return { id, enabled: false as const };
  }

  // ===== 2. locations CRUD =====

  async listLocations() {
    return db.depositLocation.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async createLocation(input: { name: string; address: string; note?: string | null; enabled?: boolean }) {
    return db.depositLocation.create({
      data: {
        name: input.name,
        address: input.address,
        note: input.note ?? null,
        enabled: input.enabled ?? true,
      },
    });
  }

  async updateLocation(id: string, input: LocationUpsertInput) {
    const existing = await db.depositLocation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-DEPOSIT-103', message: `Deposit location not found (${id})` });
    }
    return db.depositLocation.update({ where: { id }, data: input });
  }

  /** 删除缴纳点 = 软停用（骑手端 COD 下拉不再出现；历史流水 FK 不受影响） */
  async deleteLocation(id: string) {
    const existing = await db.depositLocation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-DEPOSIT-103', message: `Deposit location not found (${id})` });
    }
    await db.depositLocation.update({ where: { id }, data: { enabled: false } });
    return { id, enabled: false as const };
  }

  // ===== 3. 申请列表 =====

  /** 分页列表（默认 page=1 / pageSize=20），含骑手姓名/手机号/缴纳点名 */
  async listRequests(query: { status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED'; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { status: query.status } : {};

    const [items, total] = await Promise.all([
      db.riderDeposit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          rider: { select: { riderName: true, phone: true } },
          location: { select: { name: true } },
        },
      }),
      db.riderDeposit.count({ where }),
    ]);

    return { items: items.map(toItemView), total, page, pageSize };
  }

  // ===== 4/5. confirm / reject =====

  /**
   * 确认收款（线下 COD 主路径；ONLINE_MOCK 已付申请 admin 也可确认核对）
   *
   * 仅 PENDING。事务：条件更新（防并发重复 confirm）+ depositAmount 原子累加
   * （confirmedAmount ?? requestedAmount）。幂等：已 CONFIRMED → E-DEPOSIT-104。
   *
   * @throws E-DEPOSIT-006 不存在 / E-DEPOSIT-104 非 PENDING / E-COMMON-001 金额非法
   */
  async confirm(
    depositId: string,
    input: { confirmedAmount?: number; adminNote?: string },
  ): Promise<{ deposit: AdminDepositRequestItemView; depositAmount: number }> {
    const deposit = await db.riderDeposit.findUnique({ where: { id: depositId } });
    if (!deposit) {
      throw new NotFoundException({ code: 'E-DEPOSIT-006', message: `Deposit request not found (${depositId})` });
    }
    if (deposit.status !== 'PENDING') {
      throw new ConflictException({
        code: 'E-DEPOSIT-104',
        message: `Deposit is ${deposit.status}, only PENDING can be confirmed`,
      });
    }

    const amount = input.confirmedAmount ?? deposit.requestedAmount;
    if (amount < 100) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: `confirmedAmount must be >= 100 cents, got ${amount}`,
      });
    }

    const confirmed = await withTransaction(async (tx) => {
      // 条件更新：并发重复 confirm 只有一笔成功（与 payMock 同款模式）
      const updated = await tx.riderDeposit.updateMany({
        where: { id: depositId, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          confirmedAmount: amount,
          confirmedAt: new Date(),
          paidAt: deposit.paidAt ?? new Date(), // COD 现场交付时间缺省记确认时刻
          adminNote: input.adminNote ?? deposit.adminNote,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          code: 'E-DEPOSIT-104',
          message: 'Deposit is no longer PENDING (concurrent confirm rejected)',
        });
      }
      await tx.riderProfile.update({
        where: { id: deposit.riderId },
        data: { depositAmount: { increment: amount } },
      });
      return tx.riderDeposit.findUniqueOrThrow({
        where: { id: depositId },
        include: { rider: { select: { riderName: true, phone: true } }, location: { select: { name: true } } },
      });
    });

    const profile = await db.riderProfile.findUniqueOrThrow({
      where: { id: deposit.riderId },
      select: { depositAmount: true },
    });
    return { deposit: toItemView(confirmed), depositAmount: profile.depositAmount };
  }

  /**
   * 拒绝申请（仅 PENDING；adminNote 必填，骑手端可见）。REJECTED 后骑手可重提（批 B 已支持）。
   *
   * @throws E-DEPOSIT-006 不存在 / E-DEPOSIT-104 非 PENDING
   */
  async reject(depositId: string, input: { adminNote: string }): Promise<AdminDepositRequestItemView> {
    const deposit = await db.riderDeposit.findUnique({ where: { id: depositId } });
    if (!deposit) {
      throw new NotFoundException({ code: 'E-DEPOSIT-006', message: `Deposit request not found (${depositId})` });
    }
    if (deposit.status !== 'PENDING') {
      throw new ConflictException({
        code: 'E-DEPOSIT-104',
        message: `Deposit is ${deposit.status}, only PENDING can be rejected`,
      });
    }

    // 条件更新防并发（与 confirm/reject 竞争：只有一方能改掉 PENDING）
    const updated = await db.riderDeposit.updateMany({
      where: { id: depositId, status: 'PENDING' },
      data: { status: 'REJECTED', adminNote: input.adminNote },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: 'E-DEPOSIT-104',
        message: 'Deposit is no longer PENDING (concurrent update rejected)',
      });
    }

    const latest = await db.riderDeposit.findUniqueOrThrow({
      where: { id: depositId },
      include: { rider: { select: { riderName: true, phone: true } }, location: { select: { name: true } } },
    });
    return toItemView(latest);
  }

  // ===== 6. 骑手聚合详情（Q8 ①-⑤） =====

  /**
   * @param riderProfileId 路由 :id = riderProfile.id（admin 列表返回的骑手 id）
   * @throws E-RIDER-001 不存在
   */
  async getRiderDepositDetail(riderProfileId: string) {
    const profile = await db.riderProfile.findUnique({
      where: { id: riderProfileId },
      include: { user: { select: { id: true } } },
    });
    if (!profile) {
      throw new NotFoundException({ code: 'E-RIDER-001', message: `Rider profile not found (${riderProfileId})` });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // ② 在途任务 + ③ 今日单量 + ⑤ 缴存记录 + ④ 结算余额 并行
    const [activeTasks, todayDeliveries, depositRequests, settlements, withdrawals, tier, onlineFlags] =
      await Promise.all([
        db.deliveryTask.count({
          where: { riderId: profile.id, status: { in: ['ASSIGNED', 'PICKED_UP', 'DELIVERING'] } },
        }),
        db.deliveryTask.count({
          where: { riderId: profile.id, status: 'DELIVERED', updatedAt: { gte: todayStart } },
        }),
        db.riderDeposit.findMany({
          where: { riderId: profile.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { location: { select: { name: true } }, rider: { select: { riderName: true, phone: true } } },
        }),
        db.settlement.aggregate({
          where: { subjectType: 'RIDER', subjectId: profile.id, status: { in: ['CONFIRMED', 'PAID'] } },
          _sum: { netAmount: true },
        }),
        db.withdrawalRequest.aggregate({
          where: { requesterType: 'RIDER', requesterId: profile.id, status: 'PAID' },
          _sum: { amount: true },
        }),
        db.riderDepositTier.findFirst({
          where: { enabled: true, minAmount: { lte: profile.depositAmount } },
          orderBy: { minAmount: 'desc' },
        }),
        redis
          .pipeline()
          .exists(`rider:online:${profile.userId}`)
          .exec()
          .then((r) => (r?.[0]?.[1] as number) > 0)
          .catch(() => false),
      ]);

    return {
      basic: {
        riderProfileId: profile.id,
        userId: profile.user.id,
        riderName: profile.riderName,
        phone: profile.phone,
        vehicleType: profile.vehicleType,
        vehiclePlate: profile.vehiclePlate,
        applicationStatus: profile.applicationStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
        preferredWarehouseIds: profile.preferredWarehouseIds,
      },
      realtime: {
        status: profile.status,
        isOnline: onlineFlags,
        maybeOffline: false, // admin 聚合视图不逐骑手查 TTL 宽限（列表场景够用）
        activeTaskCount: activeTasks,
      },
      stats: {
        todayDeliveries,
        totalDeliveries: profile.totalDeliveries,
        rating: Number(profile.rating),
      },
      finance: {
        depositAmount: profile.depositAmount,
        tier,
        maxOrderAmount: tier?.maxOrderAmount ?? null,
        // 结算余额（近似）：已确认结算净额 − 已打款提现（未含 PENDING 提现冻结，MVP 够用）
        settleBalance: (settlements._sum.netAmount ?? 0) - (withdrawals._sum.amount ?? 0),
      },
      depositRequests: depositRequests.map(toItemView),
    };
  }

  // ===== 7. 各仓负载 =====

  /**
   * 每仓：待派任务数（PENDING_ASSIGN）+ 可用骑手数（APPROVED + 在线 + 工作仓含该仓）
   * + 预计等待（pending / max(available,1) × 30min 近似，方案 Q12 面板）
   */
  async getWarehouseLoad() {
    const warehouses = await db.warehouse.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, code: true, name: true },
    });
    if (warehouses.length === 0) return [];

    const [pendingTasks, approvedRiders] = await Promise.all([
      db.deliveryTask.groupBy({
        by: ['warehouseId'],
        // 批C审查 P3-1（2026-09-02 拍板修复）：只统计 ACTIVE 仓的待派任务，
        //   暂停仓的任务不进面板（此前不过滤会被静默丢弃，语义完备性修正）
        where: { status: 'PENDING_ASSIGN', warehouseId: { in: warehouses.map((w) => w.id) } },
        _count: { _all: true },
      }),
      db.riderProfile.findMany({
        where: { applicationStatus: 'APPROVED' },
        select: { id: true, userId: true, preferredWarehouseIds: true },
      }),
    ]);

    // 批量查在线（pipeline，1 次 round-trip；Redis 故障降级全离线）
    let onlineUserIds: Set<string>;
    try {
      const pipeline = redis.pipeline();
      approvedRiders.forEach((r) => pipeline.exists(`rider:online:${r.userId}`));
      const results = await pipeline.exec();
      onlineUserIds = new Set(
        approvedRiders.filter((_, i) => ((results?.[i]?.[1] as number) ?? 0) > 0).map((r) => r.id),
      );
    } catch {
      onlineUserIds = new Set();
    }

    const pendingMap = new Map(pendingTasks.map((t) => [t.warehouseId, t._count._all]));

    return warehouses.map((w) => {
      const pendingTaskCount = pendingMap.get(w.id) ?? 0;
      // 可用骑手：在线 + 工作仓含该仓（强指派，方案 Q11）
      const availableRiderCount = approvedRiders.filter(
        (r) => onlineUserIds.has(r.id) && r.preferredWarehouseIds.includes(w.id),
      ).length;
      const estWaitMinutes = Math.ceil((pendingTaskCount / Math.max(availableRiderCount, 1)) * 30);
      return {
        warehouseId: w.id,
        warehouseCode: w.code,
        warehouseName: (w.name as Record<string, string>).en ?? null,
        pendingTaskCount,
        availableRiderCount,
        estWaitMinutes,
      };
    });
  }
}

/** Prisma P2002（unique 约束冲突）类型收窄（minAmount 撞档兜底） */
function isPrismaUniqueConstraintError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002';
}
