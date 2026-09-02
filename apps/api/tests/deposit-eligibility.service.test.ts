/**
 * DepositEligibilityService 单测（批 D 资格边界 + 派生规则，2026-09-03）
 *
 * 覆盖（任务书批 D 验收）：
 *   - 档位派生：命中最高档 / 未缴=0 / 停用档回落（enabled 档过滤）/ maxOrderAmount=null 不限
 *   - assertCanAccept 资格边界：=上限可接 / >上限拒(E-DEPOSIT-202 含所需档提示) /
 *     未缴拒(E-DEPOSIT-201) / 停用档拒(回落 0 → 201)
 *   - isEligible：0=全拒 / null=全过 / 边界等值
 *   - getRequiredDeposit：找 maxOrderAmount ≥ orderAmount 的最低档 minAmount
 *   - toLabel：合格/不合格（requiredDeposit 字段条件出现）
 *
 * mock：db（riderProfile/riderDepositTier）；档位缓存用 setTierCacheForTest 注入
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    riderProfile: {
      findUnique: vi.fn(),
    },
    riderDepositTier: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));

import {
  DepositEligibilityService,
  setTierCacheForTest,
} from '../src/modules/rider/deposit-eligibility.service';

/** 默认 4 档（seed 同构）：$1→$10 / $5→$50 / $10→$100 / $50→$500 */
const DEFAULT_TIERS = [
  { id: 'tier-4', minAmount: 5000, maxOrderAmount: 50000 },
  { id: 'tier-3', minAmount: 1000, maxOrderAmount: 10000 },
  { id: 'tier-2', minAmount: 500, maxOrderAmount: 5000 },
  { id: 'tier-1', minAmount: 100, maxOrderAmount: 1000 },
];

describe('DepositEligibilityService', () => {
  let service: DepositEligibilityService;

  beforeEach(() => {
    service = new DepositEligibilityService();
    mockDb.riderProfile.findUnique.mockReset();
    mockDb.riderDepositTier.findMany.mockReset();
    // 默认注入未过期缓存（大部分用例不触 DB 档位查询）
    setTierCacheForTest(DEFAULT_TIERS);
  });

  describe('deriveEligibility 档位派生（纯函数）', () => {
    it('depositAmount=2000 → 命中 $10 档（minAmount 1000，最高 ≤2000 的启用档）', () => {
      const snap = service.deriveEligibility('r-1', 2000, DEFAULT_TIERS);
      expect(snap.tierId).toBe('tier-3');
      expect(snap.maxOrderAmount).toBe(10000);
    });

    it('未缴（0）→ 上限 0 / tier=null（无命中）', () => {
      const snap = service.deriveEligibility('r-1', 0, DEFAULT_TIERS);
      expect(snap.maxOrderAmount).toBe(0);
      expect(snap.tierId).toBeNull();
    });

    it('停用档回落（2026-09-02 拍板裁决 1）：$10 档停用后 deposit 2000 → 命中 $5 档', () => {
      const tiersWithoutTier3 = DEFAULT_TIERS.filter((t) => t.id !== 'tier-3');
      const snap = service.deriveEligibility('r-1', 2000, tiersWithoutTier3);
      expect(snap.tierId).toBe('tier-2');
      expect(snap.maxOrderAmount).toBe(5000); // 上限实时回落
    });

    it('全部启用档都高于 deposit → 上限 0（档全停/全高于已缴）', () => {
      const highTiersOnly = [DEFAULT_TIERS[0]]; // 只剩 $50 档
      const snap = service.deriveEligibility('r-1', 1000, highTiersOnly);
      expect(snap.maxOrderAmount).toBe(0);
      expect(snap.tierId).toBeNull();
    });

    it('maxOrderAmount=null 档（顶配不限）：命中后上限 null', () => {
      const tiers = [{ id: 'tier-top', minAmount: 5000, maxOrderAmount: null }];
      const snap = service.deriveEligibility('r-1', 8000, tiers);
      expect(snap.maxOrderAmount).toBeNull();
    });

    it('档位边界等值：deposit=100 → 命中 $1 档（minAmount ≤ 等值可命中）', () => {
      const snap = service.deriveEligibility('r-1', 100, DEFAULT_TIERS);
      expect(snap.tierId).toBe('tier-1');
      expect(snap.maxOrderAmount).toBe(1000);
    });
  });

  describe('assertCanAccept 资格边界', () => {
    function mockRider(depositAmount: number) {
      mockDb.riderProfile.findUnique.mockResolvedValue({ id: 'r-1', depositAmount });
    }

    it('=上限 可接（边界等值通过）', async () => {
      mockRider(1000); // 上限 10000
      const snap = await service.assertCanAccept('r-1', 10000);
      expect(snap.maxOrderAmount).toBe(10000);
    });

    it('>上限 拒 → E-DEPOSIT-202（message 含所需档提示）', async () => {
      mockRider(1000); // 上限 10000
      await expect(service.assertCanAccept('r-1', 10001)).rejects.toThrow(
        /exceeds your tier limit 10000/,
      );
    });

    it('未缴 拒 → E-DEPOSIT-201', async () => {
      mockRider(0);
      await expect(service.assertCanAccept('r-1', 500)).rejects.toThrow(
        /Deposit required before accepting/,
      );
    });

    it('停用档回落：原 $10 档骑手（2000）在档停用后接 $8000 单 → 拒 202（上限回落 5000）', async () => {
      mockRider(2000);
      setTierCacheForTest(DEFAULT_TIERS.filter((t) => t.id !== 'tier-3')); // $10 档停用
      await expect(service.assertCanAccept('r-1', 8000)).rejects.toThrow(
        /exceeds your tier limit 5000/,
      );
    });

    it('null 上限档（不限）任意金额可接', async () => {
      mockRider(8000);
      setTierCacheForTest([{ id: 'tier-top', minAmount: 5000, maxOrderAmount: null }]);
      const snap = await service.assertCanAccept('r-1', 999_999);
      expect(snap.maxOrderAmount).toBeNull();
    });

    it('骑手不存在 → E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(service.assertCanAccept('r-x', 500)).rejects.toThrow(/not found/);
    });
  });

  describe('isEligible（大厅/候选过滤判断）', () => {
    it('上限 0 → 全拒（未缴/档全停）', () => {
      expect(service.isEligible({ riderProfileId: 'r', depositAmount: 0, maxOrderAmount: 0, tierId: null }, 100)).toBe(false);
    });

    it('null 上限 → 全过', () => {
      expect(service.isEligible({ riderProfileId: 'r', depositAmount: 5000, maxOrderAmount: null, tierId: 't' }, 999_999)).toBe(true);
    });

    it('金额 = 上限 → 过（大厅与 acceptTask 语义一致）', () => {
      expect(
        service.isEligible({ riderProfileId: 'r', depositAmount: 1000, maxOrderAmount: 10000, tierId: 't3' }, 10000),
      ).toBe(true);
    });

    it('金额 > 上限 → 拒', () => {
      expect(
        service.isEligible({ riderProfileId: 'r', depositAmount: 1000, maxOrderAmount: 10000, tierId: 't3' }, 10001),
      ).toBe(false);
    });
  });

  describe('getRequiredDeposit（202 提示：所需最低保证金）', () => {
    it('orderAmount 8000 → $10 档（minAmount 1000：maxOrderAmount 10000 ≥ 8000 的最低档）', async () => {
      const req = await service.getRequiredDeposit(8000);
      expect(req).toBe(1000);
    });

    it('orderAmount 500（低于 $1 档上限 1000）→ $1 档（minAmount 100）', async () => {
      const req = await service.getRequiredDeposit(500);
      expect(req).toBe(100);
    });

    it('所有档上限都不够（60000）→ 返回最高档 minAmount（顶配提示）', async () => {
      const req = await service.getRequiredDeposit(60000);
      expect(req).toBe(5000);
    });
  });

  describe('toLabel 资格标签', () => {
    it('合格 → eligible=true 无 requiredDeposit', () => {
      const label = service.toLabel(
        { riderProfileId: 'r', depositAmount: 1000, maxOrderAmount: 10000, tierId: 't3' },
        5000,
        1000,
      );
      expect(label.eligible).toBe(true);
      expect(label.requiredDeposit).toBeUndefined();
    });

    it('不合格 → requiredDeposit 出现（⛔需保证金 $Z）', () => {
      const label = service.toLabel(
        { riderProfileId: 'r', depositAmount: 500, maxOrderAmount: 5000, tierId: 't2' },
        8000,
        1000,
      );
      expect(label.eligible).toBe(false);
      expect(label.requiredDeposit).toBe(1000);
    });
  });
});
