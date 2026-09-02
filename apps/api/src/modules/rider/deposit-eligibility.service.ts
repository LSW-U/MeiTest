/**
 * Deposit Eligibility — 保证金派单资格（批 D，2026-09-03）
 *
 * 方案：Obsidian 保证金与派单体系方案/02-CC任务书-后端接口.md 批 D + 2026-09-02 拍板裁决
 *
 * 三处强制拦截（方案 Q9）：
 *   1. acceptTask：接单前校验「订单金额 ≤ 档位上限」
 *   2. listPendingTasks（抢单大厅）：超上限任务不出现在大厅
 *   3. admin 派单候选：资格过滤 + 排序 + 资格标签
 *
 * 停用档语义（2026-09-02 拍板裁决 1）：
 *   tier.enabled=false = 完全退出派单资格，上限实时回落——
 *   已缴骑手按「仍启用档中 minAmount ≤ depositAmount 的最高档」算；
 *   无启用档命中 → 上限 0（钱不退，退款走 REFUNDED 专项）。
 *
 * 错误码（派单段 201/202，与骑手 001-007 / admin 101-104 区分）：
 *   E-DEPOSIT-201 未缴保证金（depositAmount 命不中任何启用档）
 *   E-DEPOSIT-202 订单金额超档位上限（message 含所需档位提示）
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { db } from '../../shared/db';

/** 派单排序权重（方案 Q10：评分×0.5 + 距离近度×0.3 − 在途×0.2；提常量便于调参） */
export const DISPATCH_SCORE_WEIGHTS = {
  rating: 0.5,
  distance: 0.3,
  inTransit: 0.2,
} as const;

/** 距离归一化上限（km）：超过此距离的骑手距离分记 0（防远距离候选得分失真） */
export const SCORE_MAX_DISTANCE_KM = 10;

/** 资格快照：一次查询的派生结果（上限 + 命中档） */
export interface EligibilitySnapshot {
  riderProfileId: string;
  depositAmount: number;
  /** 可接订单金额上限（分）；0 = 无资格（未缴/档全停）；null = 不限 */
  maxOrderAmount: number | null;
  /** 命中的启用档（null = 未命中） */
  tierId: string | null;
}

/** 资格标签（admin 候选列表输出，契约 DispatchCandidate.eligibility） */
export interface EligibilityLabel {
  eligible: boolean;
  depositAmount: number;
  maxOrderAmount: number | null;
  /** 不合格时：接到该单所需的最低保证金（分，命中该订单金额的最低启用档 minAmount） */
  requiredDeposit?: number;
}

@Injectable()
export class DepositEligibilityService {
  /**
   * 查单个骑手资格快照（上限派生不落库，实时查启用档）
   *
   * 派生规则：启用档中 minAmount ≤ depositAmount 的最高档 → 其 maxOrderAmount；
   * 无命中 → { maxOrderAmount: 0, tierId: null }（停用档回落，裁决 1）。
   */
  async getEligibility(riderProfileId: string): Promise<EligibilitySnapshot> {
    const profile = await db.riderProfile.findUnique({
      where: { id: riderProfileId },
      select: { id: true, depositAmount: true },
    });
    if (!profile) {
      throw new BadRequestException({
        code: 'E-RIDER-001',
        message: `Rider profile not found (${riderProfileId})`,
      });
    }
    const enabledTiers = await this.getEnabledTiers();
    return this.deriveEligibility(profile.id, profile.depositAmount, enabledTiers);
  }

  /** 纯派生（不查库）：给定启用档列表 + depositAmount 算上限——单测友好 + 批量场景复用预取档 */
  deriveEligibility(
    riderProfileId: string,
    depositAmount: number,
    enabledTiers: Array<{ id: string; minAmount: number; maxOrderAmount: number | null }>,
  ): EligibilitySnapshot {
    const hit = enabledTiers
      .filter((t) => t.minAmount <= depositAmount)
      .sort((a, b) => b.minAmount - a.minAmount)[0];
    if (!hit) return { riderProfileId, depositAmount, maxOrderAmount: 0, tierId: null };
    return { riderProfileId, depositAmount, maxOrderAmount: hit.maxOrderAmount, tierId: hit.id };
  }

  /**
   * 批量预取启用档（admin 候选/大厅过滤场景：一次查询复用 N 个骑手/任务）
   * 缓存策略：进程内 60s + **tier CRUD 后主动失效**（批D审查 P3-1 裁决 2026-09-03：
   * admin-deposit 的 create/update/deleteTier 成功后调 clearTierCache，
   * 「停用档立即回落」单进程实时生效；多进程 Redis 版本号 bump 记批 E TODO）
   */
  async getEnabledTiers(): Promise<Array<{ id: string; minAmount: number; maxOrderAmount: number | null }>> {
    const now = Date.now();
    if (tierCache.data && now - tierCache.at < TIER_CACHE_MS) return tierCache.data;
    const tiers = await db.riderDepositTier.findMany({
      where: { enabled: true },
      select: { id: true, minAmount: true, maxOrderAmount: true },
      orderBy: { minAmount: 'desc' },
    });
    tierCache = { data: tiers, at: now };
    return tiers;
  }

  /**
   * 清空档位缓存（tier CRUD 成功后由 AdminDepositService 调用）
   * 单进程内即时生效：下次 getEnabledTiers 强制回源 DB
   */
  clearTierCache(): void {
    tierCache = { data: [], at: 0 };
  }

  /**
   * acceptTask 资格校验（方案 Q9 第 1 处强制拦截）
   *
   * @param orderAmount 订单金额（分，payableAmount）
   * @throws E-DEPOSIT-201 未缴（无启用档命中）
   * @throws E-DEPOSIT-202 金额超上限（message 含所需保证金档提示）
   */
  async assertCanAccept(riderProfileId: string, orderAmount: number): Promise<EligibilitySnapshot> {
    const snap = await this.getEligibility(riderProfileId);
    // 未缴/档全停：maxOrderAmount = 0 → 任何单都拒
    if (snap.maxOrderAmount === 0) {
      throw new ForbiddenException({
        code: 'E-DEPOSIT-201',
        message: `Deposit required before accepting tasks (current deposit: ${snap.depositAmount} cents, no active tier matched)`,
      });
    }
    // 命中档但金额超上限（null = 不限，永不拒）
    if (snap.maxOrderAmount !== null && orderAmount > snap.maxOrderAmount) {
      const required = await this.getRequiredDeposit(orderAmount);
      throw new ForbiddenException({
        code: 'E-DEPOSIT-202',
        message: `Order amount ${orderAmount} exceeds your tier limit ${snap.maxOrderAmount} (deposit ${required ?? 0}+ needed)`,
      });
    }
    return snap;
  }

  /**
   * 大厅/候选过滤判断（不抛错，返回 boolean）
   * maxOrderAmount=0 → 全拒；null → 全过；否则按金额比。
   */
  isEligible(snapshot: EligibilitySnapshot, orderAmount: number): boolean {
    if (snapshot.maxOrderAmount === 0) return false;
    if (snapshot.maxOrderAmount === null) return true;
    return orderAmount <= snapshot.maxOrderAmount;
  }

  /**
   * 接到「该金额订单」所需最低保证金（分）：启用档中 minAmount ≥ orderAmount/10…
   * 实际语义：找 maxOrderAmount ≥ orderAmount 的最低档的 minAmount（转 202 的提示用）。
   * 无适用档（所有启用档上限都不够）→ 返回最高档 minAmount（提示升级到顶配也不够，
   * 实际此刻 admin 应增设高档；返回值仅用于提示文案）。
   */
  async getRequiredDeposit(orderAmount: number): Promise<number | undefined> {
    const tiers = await this.getEnabledTiers();
    const suitable = tiers
      .filter((t) => t.maxOrderAmount === null || t.maxOrderAmount >= orderAmount)
      .sort((a, b) => a.minAmount - b.minAmount);
    return suitable[0]?.minAmount ?? [...tiers].sort((a, b) => b.minAmount - a.minAmount)[0]?.minAmount;
  }

  /** 资格标签输出（admin 候选列表，契约 DispatchCandidate.eligibility） */
  toLabel(snapshot: EligibilitySnapshot, orderAmount: number, requiredDeposit?: number): EligibilityLabel {
    const eligible = this.isEligible(snapshot, orderAmount);
    return {
      eligible,
      depositAmount: snapshot.depositAmount,
      maxOrderAmount: snapshot.maxOrderAmount,
      ...(eligible ? {} : { requiredDeposit: requiredDeposit ?? snapshot.depositAmount }),
    };
  }
}

/** 档位进程内缓存（getEnabledTiers 60s） */
const TIER_CACHE_MS = 60_000;
let tierCache: { data: Array<{ id: string; minAmount: number; maxOrderAmount: number | null }>; at: number } = {
  data: [],
  at: 0,
};

/** 单测注入入口：直接替换缓存档位（绕过 DB） */
export function setTierCacheForTest(tiers: Array<{ id: string; minAmount: number; maxOrderAmount: number | null }>): void {
  tierCache = { data: tiers, at: Date.now() };
}
