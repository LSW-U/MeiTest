/**
 * MeiMart 修复客户端食品商品 stock 分配（一次性补丁）
 *
 * 背景：seed-client-foods.ts 早期版本用两次 Math.floor 分配 stock，余数丢失：
 *   - 牛奶 stock=3 全丢成 0（6 条 stock 全 0）
 *   - 鸡蛋 12→9、抽纸 18→15、苹果 85→84 等（floor 损耗）
 *
 * 本脚本对已 seed 的 10 个食品商品重新分配 stock（用与 seed 同源的 distributeStock）。
 * 幂等：重跑也是重算到正确值。
 *
 * 用法：cd apps/api && pnpm tsx prisma/fix-food-stock.ts
 * 前置：seed-client-foods.ts 已跑过（保证 10 个食品商品 + SKU 存在）
 */
import { PrismaClient } from '../src/prisma/client';

const prisma = new PrismaClient();

/** stock 分配：与 seed-client-foods.ts 同源。
 *  内联（而非 import）—— 避免触发 seed-client-foods.ts 的 top-level main() side effect。 */
function distributeStock(
  totalStock: number,
  whCount: number,
): { small: number[]; large: number[] } {
  const smallTotal = Math.floor(totalStock * 0.6);
  const largeTotal = totalStock - smallTotal;
  const split = (total: number) => {
    const base = Math.floor(total / whCount);
    const rem = total % whCount;
    return Array.from({ length: whCount }, (_, i) => base + (i < rem ? 1 : 0));
  };
  return { small: split(smallTotal), large: split(largeTotal) };
}

/**
 * 10 个食品商品（name.en → 名义 stock）。
 * 与 seed-client-foods.ts 的 CLIENT_PRODUCTS p001-p010 一致，勿单独改。
 */
const FOOD_STOCKS: Record<string, number> = {
  'Fresh Red Fuji Apple': 85,
  'Free-Range Eggs (30 pack)': 12,
  'Pearl Rice 5kg': 0, // OUT_OF_STOCK
  'Cooking Oil 5L': 50,
  'Pure Milk 250ml × 12': 3,
  'Tsingtao Beer 500ml × 12': 40,
  'Snacks Variety Pack': 25,
  'Toothpaste Set (3 pack)': 0, // OUT_OF_STOCK
  'Tissue Paper 24 pack': 18,
  'Imported Salmon 200g': 60,
};

async function main() {
  console.log('🔧 Fixing client food stock allocation...\n');
  const warehouses = await prisma.warehouse.findMany();
  if (warehouses.length === 0) {
    throw new Error('No warehouses found. Run main seed.ts first.');
  }

  let fixed = 0;
  let notFound = 0;
  for (const [nameEn, totalStock] of Object.entries(FOOD_STOCKS)) {
    // Standard（便宜）在前，Family（贵 ×1.8）在后 —— orderBy price asc 保证顺序
    const product = await prisma.product.findFirst({
      where: { name: { path: ['en'], equals: nameEn } },
      include: { skus: { orderBy: { price: 'asc' } } },
    });
    if (!product || product.skus.length < 2) {
      console.log(`  ⚠️ not found or < 2 skus: ${nameEn}`);
      notFound++;
      continue;
    }
    const skuSmall = product.skus[0];
    const skuLarge = product.skus[1];

    // 删旧 stock（所有仓库的这两个 sku）
    await prisma.stock.deleteMany({ where: { skuId: { in: [skuSmall.id, skuLarge.id] } } });

    // 重算分配 + create
    const dist = distributeStock(totalStock, warehouses.length);
    for (const [idx, wh] of warehouses.entries()) {
      await prisma.stock.create({
        data: { warehouseId: wh.id, skuId: skuSmall.id, quantity: dist.small[idx], safetyStock: 5 },
      });
      await prisma.stock.create({
        data: { warehouseId: wh.id, skuId: skuLarge.id, quantity: dist.large[idx], safetyStock: 3 },
      });
    }

    const sumStock =
      dist.small.reduce((a, b) => a + b, 0) + dist.large.reduce((a, b) => a + b, 0);
    console.log(
      `  ✅ ${nameEn}: total=${totalStock} → distributed=${sumStock} ` +
        `(small [${dist.small.join(',')}] large [${dist.large.join(',')}])`,
    );
    fixed++;
  }

  console.log(`\n  ✅ ${fixed} products fixed, ${notFound} not found`);
  console.log('🎉 Stock fix completed!');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Fix failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
