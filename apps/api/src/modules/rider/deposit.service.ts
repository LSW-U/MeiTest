/**
 * RiderDeposit Service — 骑手侧保证金（批 B，2026-09-02）
 *
 * 方案：Obsidian 保证金与派单体系方案/02-CC任务书-后端接口.md 批 B
 *   - 提交申请（双通道：ONLINE_MOCK 待 pay-mock / OFFLINE_COD 待 admin 确认）
 *   - pay-mock：事务内 CONFIRMED + confirmedAmount + paidAt + depositAmount 累加（幂等）
 *   - status：余额 + 命中档位（派生不落库）+ 最近 10 条申请
 *
 * 状态机：PENDING → CONFIRMED / REJECTED；REJECTED 可重新提交（新流水）；
 *   REFUNDED 仅 admin 侧（批 C+），本 service 不产生该状态。
 *
 * 错误码（E-DEPOSIT 001-006）：
 *   001 金额不足（< 100 分 = $1）
 *   002 OFFLINE_COD 缺缴纳点 / 缴纳点不存在或已停用
 *   003 pay-mock 非 ONLINE_MOCK 通道
 *   004 非法状态流转（如 REJECTED/REFUNDED 走 pay-mock）
 *   005 非本人申请
 *   006 申请不存在
 *   007 已有进行中的 PENDING 申请（跨通道互斥，批 B 修正）
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../../shared/db';
import { withTransaction } from '../../shared/db';

/** 最小缴纳额（分）= $1（方案 §二 业务规则 1） */
export const MIN_DEPOSIT_AMOUNT = 100;

/** DTO 类型（与 packages/api-contract/src/schemas/rider.ts 同步） */
export interface CreateDepositInput {
  riderUserId: string;
  channel: 'ONLINE_MOCK' | 'OFFLINE_COD';
  amount: number;
  locationId?: string;
  note?: string;
}

/** 档位视图（契约 RiderDepositTier） */
export interface DepositTierView {
  id: string;
  minAmount: number;
  maxOrderAmount: number | null;
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 流水视图（契约 RiderDepositRecord） */
export interface DepositRecordView {
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
}

/** status 端点响应（契约 RiderDepositStatusResponse） */
export interface DepositStatusView {
  depositAmount: number;
  tier: DepositTierView | null;
  recentRequests: DepositRecordView[];
}

/** DB 流水 → 视图（字段一一对应，独立函数便于单测） */
function toRecordView(d: {
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
}): DepositRecordView {
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
  };
}

@Injectable()
export class RiderDepositService {
  /**
   * 按 userId 定位 RiderProfile（service 惯例：传入的是 user.sub，非 profile.id）
   * @throws E-RIDER-001 资料不存在
   */
  private async getProfileByUserId(userId: string) {
    const profile = await db.riderProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Rider profile not found (please apply first)',
      });
    }
    return profile;
  }

  /**
   * 提交缴纳申请（POST /rider/deposit/requests）
   *
   * - ONLINE_MOCK：创建 PENDING（待骑手调 pay-mock 完成模拟支付）
   * - OFFLINE_COD：必须带 locationId 且缴纳点 enabled=true；创建 PENDING（待 admin 确认）
   * - PENDING 互斥（批 B 修正 2026-09-02）：同一骑手同时最多一笔 PENDING（跨通道互斥）；
   *   REJECTED 后可重提（新流水）、CONFIRMED 后可再提（累加）
   *
   * @throws E-DEPOSIT-001 金额 < 100
   * @throws E-DEPOSIT-002 COD 缺缴纳点 / 缴纳点不可用
   * @throws E-DEPOSIT-007 已有进行中的 PENDING 申请
   * @throws E-RIDER-001   骑手资料不存在
   */
  async createRequest(input: CreateDepositInput): Promise<DepositRecordView> {
    if (input.amount < MIN_DEPOSIT_AMOUNT) {
      throw new BadRequestException({
        code: 'E-DEPOSIT-001',
        message: `Deposit amount must be >= ${MIN_DEPOSIT_AMOUNT} cents ($1), got ${input.amount}`,
      });
    }

    const profile = await this.getProfileByUserId(input.riderUserId);

    // PENDING 互斥：查现有进行中申请（跨通道），409 语义
    const existing = await db.riderDeposit.findFirst({
      where: { riderId: profile.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      throw new ConflictException({
        code: 'E-DEPOSIT-007',
        message: `Already has a pending deposit request (${existing.channel}, $${(existing.requestedAmount / 100).toFixed(2)})`,
      });
    }

    // COD 校验缴纳点（enabled=true 才可选）
    let location: { id: string } | null = null;
    if (input.channel === 'OFFLINE_COD') {
      if (!input.locationId) {
        throw new BadRequestException({
          code: 'E-DEPOSIT-002',
          message: 'locationId is required for OFFLINE_COD deposits',
        });
      }
      const loc = await db.depositLocation.findUnique({ where: { id: input.locationId } });
      if (!loc || !loc.enabled) {
        throw new BadRequestException({
          code: 'E-DEPOSIT-002',
          message: `Deposit location not found or disabled (locationId=${input.locationId})`,
        });
      }
      location = loc;
    }

    let deposit;
    try {
      deposit = await db.riderDeposit.create({
        data: {
          riderId: profile.id,
          channel: input.channel,
          requestedAmount: input.amount,
          status: 'PENDING',
          locationId: location?.id ?? null,
          note: input.note ?? null,
        },
      });
    } catch (e) {
      // 批B审查 P2-1：partial unique index（rider_deposits_pending_unique）兜底——
      //   并发双击绕过上方 findFirst 检查时，第二笔 create 触发 P2002，转 409 互斥错误
      if (isPrismaUniqueConstraintError(e)) {
        throw new ConflictException({
          code: 'E-DEPOSIT-007',
          message: 'Already has a pending deposit request (concurrent create rejected)',
        });
      }
      throw e;
    }
    return toRecordView(deposit);
  }

  /**
   * 线上模拟支付（POST /rider/deposit/requests/:id/pay-mock）
   *
   * 仅 ONLINE_MOCK + PENDING：事务内置 CONFIRMED + confirmedAmount=requestedAmount
   * + paidAt/confirmedAt + RiderProfile.depositAmount 累加。
   * 幂等：已 CONFIRMED 直接返回（不重复累加）；并发双击由事务内条件更新兜底
   *   （updateMany where status=PENDING，0 行命中 → 读 latest 分流：
   *   CONFIRMED = 幂等成功；REJECTED/REFUNDED = E-DEPOSIT-004，批B审查 P2-2）。
   *
   * @throws E-DEPOSIT-003 非 ONLINE_MOCK
   * @throws E-DEPOSIT-004 非法流转（REJECTED/REFUNDED，含并发被 admin 拒）
   * @throws E-DEPOSIT-005 非本人申请
   * @throws E-DEPOSIT-006 申请不存在
   */
  async payMock(riderUserId: string, depositId: string): Promise<{ deposit: DepositRecordView; depositAmount: number }> {
    const profile = await this.getProfileByUserId(riderUserId);

    const deposit = await db.riderDeposit.findUnique({ where: { id: depositId } });
    if (!deposit) {
      throw new NotFoundException({ code: 'E-DEPOSIT-006', message: `Deposit request not found (${depositId})` });
    }
    if (deposit.riderId !== profile.id) {
      throw new ForbiddenException({ code: 'E-DEPOSIT-005', message: 'Not your deposit request' });
    }
    if (deposit.channel !== 'ONLINE_MOCK') {
      throw new BadRequestException({
        code: 'E-DEPOSIT-003',
        message: `pay-mock only for ONLINE_MOCK channel (got ${deposit.channel})`,
      });
    }

    // 幂等：已确认直接返回
    if (deposit.status === 'CONFIRMED') {
      return { deposit: toRecordView(deposit), depositAmount: profile.depositAmount };
    }
    if (deposit.status !== 'PENDING') {
      throw new IllegalTransitionException(deposit.status);
    }

    // 事务：条件更新（防并发双击重复累加）+ 余额累加
    const confirmed = await withTransaction(async (tx) => {
      const updated = await tx.riderDeposit.updateMany({
        where: { id: depositId, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          confirmedAmount: deposit.requestedAmount,
          paidAt: new Date(),
          confirmedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        // 并发兜底（批B审查 P2-2 分流）：0 行命中有两条路径——
        //   ① 并发 pay-mock 已 CONFIRMED → 幂等成功返回
        //   ② admin（批 C confirm/reject 不分通道）已 REJECTED → 不能当成功，
        //     抛 E-DEPOSIT-004，骑手端能看到「已被拒」而非假「支付成功」
        const latest = await tx.riderDeposit.findUniqueOrThrow({ where: { id: depositId } });
        if (latest.status !== 'CONFIRMED') {
          throw new IllegalTransitionException(latest.status);
        }
        return latest;
      }
      const rider = await tx.riderProfile.update({
        where: { id: profile.id },
        data: { depositAmount: { increment: deposit.requestedAmount } },
      });
      const latest = await tx.riderDeposit.findUniqueOrThrow({ where: { id: depositId } });
      void rider;
      return latest;
    });

    const latestProfile = await db.riderProfile.findUniqueOrThrow({
      where: { id: profile.id },
      select: { depositAmount: true },
    });
    return { deposit: toRecordView(confirmed), depositAmount: latestProfile.depositAmount };
  }

  /**
   * 保证金状态（GET /rider/deposit/status）
   *
   * 档位派生规则（方案 §二 规则 2）：depositAmount ≥ minAmount 的最高档（enabled）；
   * 未命中任何档 → tier=null（未缴/低于最低档）。
   */
  async getStatus(riderUserId: string): Promise<DepositStatusView> {
    const profile = await this.getProfileByUserId(riderUserId);

    // 命中档位：enabled 档中 minAmount ≤ depositAmount 的最大 minAmount 档
    const tier = await db.riderDepositTier.findFirst({
      where: { enabled: true, minAmount: { lte: profile.depositAmount } },
      orderBy: { minAmount: 'desc' },
    });

    const recent = await db.riderDeposit.findMany({
      where: { riderId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      depositAmount: profile.depositAmount,
      tier: tier
        ? {
            id: tier.id,
            minAmount: tier.minAmount,
            maxOrderAmount: tier.maxOrderAmount,
            sortOrder: tier.sortOrder,
            enabled: tier.enabled,
            createdAt: tier.createdAt,
            updatedAt: tier.updatedAt,
          }
        : null,
      recentRequests: recent.map(toRecordView),
    };
  }

  // ===== 补端点批（2026-09-03）：骑手端只读两端点（线下缴纳下拉 / 档位提示） =====

  /**
   * 启用缴纳点列表（GET /rider/deposit/locations）
   *
   * 与 admin 侧同源（deposit_locations 表），只读 + enabled 过滤——骑手端
   * COD 下拉只看到 admin 启用的点。字段收窄到骑手端所需（id/name/address/note）。
   */
  async listEnabledLocations(): Promise<Array<{ id: string; name: string; address: string; note: string | null }>> {
    return db.depositLocation.findMany({
      where: { enabled: true },
      select: { id: true, name: true, address: true, note: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 启用档位列表（GET /rider/deposit/tiers）
   *
   * 骑手端缴纳页「选 $X → 上限 $Y」提示的数据源；与资格派生同口径（enabled 过滤）。
   */
  async listEnabledTiers(): Promise<DepositTierView[]> {
    return db.riderDepositTier.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}

/** REJECTED/REFUNDED 等终态走 pay-mock 的非法流转（409 语义） */
class IllegalTransitionException extends ConflictException {
  constructor(status: string) {
    super({ code: 'E-DEPOSIT-004', message: `Illegal transition: cannot pay-mock a ${status} deposit` });
  }
}

/** Prisma P2002（unique 约束冲突）类型收窄（批B审查 P2-1 并发兜底用） */
function isPrismaUniqueConstraintError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  );
}
