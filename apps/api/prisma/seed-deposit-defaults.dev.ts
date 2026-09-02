/**
 * Dev 种子脚本：保证金默认档位 + 默认缴纳点（批 A，2026-09-02）
 *
 * 来源：Obsidian 保证金与派单体系方案/02-CC任务书-后端接口.md 批 A §改动 3
 *   - 默认档位 4 档（等价于 ×10 封顶 $500）：$1→$10、$5→$50、$10→$100、$50→$500
 *   - 默认缴纳点 3 个：Dili / Baucau / Maliana Office
 *   - rider_deposits 不预置数据
 *
 * 用法：pnpm --filter @meimart/api exec tsx prisma/seed-deposit-defaults.dev.ts
 *
 * 幂等：
 *   - 档位按 minAmount 唯一键 upsert（admin 后续改过 maxOrderAmount/sortOrder 的档不会被覆盖
 *     ——update 分支只复位 enabled，尊重 admin 编辑）
 *   - 缴纳点按 name 查找，存在则跳过（admin 改过地址/启停的不会被覆盖）
 *
 * ⚠️ DEV/STAGING ONLY —— prod 档位/缴纳点由 admin 后台维护，不跑本脚本。
 */
import { PrismaClient } from '../src/prisma/client';

const prisma = new PrismaClient();

/** 默认档位（单位：分）：minAmount → maxOrderAmount；sortOrder 与金额同序 */
const DEFAULT_TIERS: ReadonlyArray<{
  minAmount: number;
  maxOrderAmount: number;
  sortOrder: number;
}> = [
  { minAmount: 100, maxOrderAmount: 1_000, sortOrder: 1 }, // $1 → 可接 $10
  { minAmount: 500, maxOrderAmount: 5_000, sortOrder: 2 }, // $5 → 可接 $50
  { minAmount: 1_000, maxOrderAmount: 10_000, sortOrder: 3 }, // $10 → 可接 $100
  { minAmount: 5_000, maxOrderAmount: 50_000, sortOrder: 4 }, // $50 → 可接 $500（封顶）
];

/** 默认线下缴纳点（东帝汶 3 城） */
const DEFAULT_LOCATIONS: ReadonlyArray<{ name: string; address: string; note: string }> = [
  { name: 'Dili Office', address: 'Dili, Timor-Leste', note: 'Main office' },
  { name: 'Baucau Office', address: 'Baucau, Timor-Leste', note: '' },
  { name: 'Maliana Office', address: 'Maliana, Timor-Leste', note: '' },
];

async function main(): Promise<void> {
  // 1) 档位：按 minAmount upsert；已存在只复位 enabled（admin 的编辑不覆盖）
  for (const tier of DEFAULT_TIERS) {
    await prisma.riderDepositTier.upsert({
      where: { minAmount: tier.minAmount },
      create: { ...tier, enabled: true },
      update: { enabled: true },
    });
  }
  const tierCount = await prisma.riderDepositTier.count();
  console.log(`✅ 档位就绪：默认 ${DEFAULT_TIERS.length} 档 upsert 完成（当前库共 ${tierCount} 条）`);

  // 2) 缴纳点：按 name 查找，缺失才创建（admin 编辑不覆盖）
  for (const loc of DEFAULT_LOCATIONS) {
    const exists = await prisma.depositLocation.findFirst({ where: { name: loc.name } });
    if (!exists) {
      await prisma.depositLocation.create({ data: { ...loc, enabled: true } });
    }
  }
  const locCount = await prisma.depositLocation.count();
  console.log(`✅ 缴纳点就绪：默认 ${DEFAULT_LOCATIONS.length} 个（当前库共 ${locCount} 条）`);

  console.log('\n🎉 deposit defaults seeded (idempotent, safe to re-run)');
}

main()
  .catch((e) => {
    console.error('❌ seed-deposit-defaults.dev failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
