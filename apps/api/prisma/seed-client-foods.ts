/**
 * MeiMart 客户端食品商品增量 seed 脚本
 *
 * 用途：把客户端 apps/client-app/mocks/data/products.json 的 10 个食品/日用品商品
 *       seed 进后端 DB，让 admin-web 后台也能看到（与现有 40 个美妆并存成 50 个）。
 *
 * 特点：
 *   - 增量 upsert（by name.en + shopId 去重），不 deleteMany，不碰现有 40 个商品
 *   - 幂等：重跑 created=0 / skipped=10，保护已手动修改的数据
 *   - 图片直接用前端 unsplash URL（不传 MinIO，避免依赖本地对象存储）
 *   - 4 语言 i18n（en/zh/id/pt）；前端只有 {zh,en,tet}，缺的 id/pt 用 en 兜底
 *   - 新建 9 个食品分类（fruits/eggs/grain/oil/dairy/drinks/snacks/household/seafood）
 *
 * 用法：cd apps/api && pnpm tsx prisma/seed-client-foods.ts
 *       前置：主 seed.ts 已跑过（保证 shop + warehouses 存在）
 *
 * 数据源：apps/client-app/mocks/data/products.json（p001-p010，2026-07 对齐）
 */
import { PrismaClient } from '../src/prisma/client';

const prisma = new PrismaClient();

/** 主 seed.ts 固定的 shop id */
const SHOP_ID = '00000000-0000-0000-0000-000000000001';

/** i18n 助手：构造后端 4 语言字段（en/zh/id/pt） */
function i18n(en: string, zh: string, id: string, pt: string): Record<string, string> {
  return { en, zh, id, pt };
}

/** 元 → 分（后端 price 字段用整数分） */
const yuanToCents = (yuan: number) => Math.round(yuan * 100);

/** stock 分配：总库存按 60% Standard + 40% Family 拆分，再均分到各仓库。
 *  余数补到前几个仓库（避免 Math.floor 两次取整导致库存丢失，如 stock=3 全丢成 0）。
 *  导出供 fix-food-stock.ts 复用，保证补丁与 seed 逻辑同源。 */
export function distributeStock(
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

/** 前端 mock 商品结构 */
type ClientProduct = {
  id: string;
  name: { zh: string; en: string; tet: string };
  price: number;
  originalPrice?: number;
  image: string;
  category: string;
  rating: number;
  salesCount: number;
  stock: number;
  description?: { zh: string; en: string; tet: string };
};

/** 前端 category slug → 后端分类 i18n 名 + sortOrder */
const CATEGORY_DEFS: Record<string, { name: ReturnType<typeof i18n>; sortOrder: number }> = {
  fruits:    { name: i18n('Fruits',     '水果',     'Buah-buahan',     'Frutas'),             sortOrder: 10 },
  eggs:      { name: i18n('Eggs',       '蛋类',     'Telur',           'Ovos'),               sortOrder: 11 },
  grain:     { name: i18n('Grain',      '米面粮油', 'Biji-bijian',     'Cereais'),            sortOrder: 12 },
  oil:       { name: i18n('Cooking Oil','食用油',   'Minyak Goreng',   'Óleo de Cozinhar'),   sortOrder: 13 },
  dairy:     { name: i18n('Dairy',      '乳制品',   'Produk Susu',     'Laticínios'),         sortOrder: 14 },
  drinks:    { name: i18n('Drinks',     '饮料',     'Minuman',         'Bebidas'),            sortOrder: 15 },
  snacks:    { name: i18n('Snacks',     '零食',     'Camilan',         'Lanches'),            sortOrder: 16 },
  household: { name: i18n('Household',  '日用品',   'Perlengkapan',    'Artigos Domésticos'), sortOrder: 17 },
  seafood:   { name: i18n('Seafood',    '海鲜',     'Makanan Laut',    'Marisco'),            sortOrder: 18 },
};

/**
 * 10 个客户端商品（与 apps/client-app/mocks/data/products.json 完全一致）
 * 缺 description 的用空串（后端 description 可空）
 */
const CLIENT_PRODUCTS: ClientProduct[] = [
  {
    id: 'p001',
    name: { zh: '新鲜红富士苹果', en: 'Fresh Red Fuji Apple', tet: 'Maçã Fuji Vermelha Frescu' },
    price: 25.9, originalPrice: 35.0,
    image: 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=400',
    category: 'fruits', rating: 4.8, salesCount: 1280, stock: 85,
    description: { zh: '山东烟台直供新鲜红富士苹果，个大脆甜', en: 'Fresh Red Fuji apples sourced directly from Yantai — crisp and sweet', tet: 'Maçã Fuji vermella fresku, moruk no meten' },
  },
  {
    id: 'p002',
    name: { zh: '本地土鸡蛋 30枚装', en: 'Free-Range Eggs (30 pack)', tet: 'Manu Tolun 30' },
    price: 38.5, originalPrice: 48.0,
    image: 'https://images.unsplash.com/photo-1582722872445-44dc5f43e784?w=400',
    category: 'eggs', rating: 4.9, salesCount: 2450, stock: 12,
    description: { zh: '农家散养土鸡蛋，新鲜直达', en: 'Free-range farm eggs delivered fresh', tet: 'Tolun manu sirku livre, simu fresku' },
  },
  {
    id: 'p003',
    name: { zh: '东北珍珠米 5kg', en: 'Pearl Rice 5kg', tet: 'Horas Mutin 5kg' },
    price: 49.9,
    image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400',
    category: 'grain', rating: 4.7, salesCount: 890, stock: 0,
  },
  {
    id: 'p004',
    name: { zh: '金龙鱼食用油 5L', en: 'Cooking Oil 5L', tet: 'Minan Tahan 5L' },
    price: 78.0, originalPrice: 89.0,
    image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400',
    category: 'oil', rating: 4.6, salesCount: 1560, stock: 50,
  },
  {
    id: 'p005',
    name: { zh: '蒙牛纯牛奶 250ml×12', en: 'Pure Milk 250ml × 12', tet: 'Sasán Lét 250ml × 12' },
    price: 42.9,
    image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400',
    category: 'dairy', rating: 4.8, salesCount: 3200, stock: 3,
  },
  {
    id: 'p006',
    name: { zh: '青岛啤酒 500ml×12', en: 'Tsingtao Beer 500ml × 12', tet: 'Bir Tsingtao 500ml × 12' },
    price: 58.0, originalPrice: 68.0,
    image: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=400',
    category: 'drinks', rating: 4.7, salesCount: 1890, stock: 40,
  },
  {
    id: 'p007',
    name: { zh: '薯片零食大礼包', en: 'Snacks Variety Pack', tet: 'Pakote Snack' },
    price: 35.9,
    image: 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=400',
    category: 'snacks', rating: 4.5, salesCount: 980, stock: 25,
  },
  {
    id: 'p008',
    name: { zh: '中华牙膏套装 3支装', en: 'Toothpaste Set (3 pack)', tet: 'Pasta Ihan 3' },
    price: 29.9,
    image: 'https://images.unsplash.com/photo-1559591937-abc5e0e8e21a?w=400',
    category: 'household', rating: 4.9, salesCount: 4500, stock: 0,
  },
  {
    id: 'p009',
    name: { zh: '清风原木抽纸 24包', en: 'Tissue Paper 24 pack', tet: 'Surat Tisu 24' },
    price: 45.0, originalPrice: 55.0,
    image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=400',
    category: 'household', rating: 4.8, salesCount: 5200, stock: 18,
  },
  {
    id: 'p010',
    name: { zh: '进口三文鱼 200g', en: 'Imported Salmon 200g', tet: 'Salmaun Importadu 200g' },
    price: 89.9,
    image: 'https://images.unsplash.com/photo-1599084993091-1cb5c0721cc6?w=400',
    category: 'seafood', rating: 4.9, salesCount: 670, stock: 60,
  },
];

/** 单位（前端无 unit 字段，统一用 pack） */
const UNIT_PACK = i18n('pack', '包', 'bungkus', 'pacote');

async function main() {
  console.log('🌱 Seeding client food products (incremental)...');

  // 1. 前置检查：shop + warehouses 必须存在（主 seed.ts 已建）
  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID } });
  if (!shop) {
    throw new Error(`Shop ${SHOP_ID} not found. Run main seed.ts (pnpm db:seed) first.`);
  }
  const warehouses = await prisma.warehouse.findMany();
  if (warehouses.length === 0) {
    throw new Error('No warehouses found. Run main seed.ts (pnpm db:seed) first.');
  }
  console.log(`  ✅ shop + ${warehouses.length} warehouses ready`);

  // 2. upsert 9 个食品分类（by name.en 去重，幂等）
  const categoryMap = new Map<string, string>();
  for (const [slug, def] of Object.entries(CATEGORY_DEFS)) {
    const existing = await prisma.category.findFirst({
      where: { name: { path: ['en'], equals: def.name.en } },
    });
    const cat = existing
      ? await prisma.category.update({
          where: { id: existing.id },
          data: { name: def.name, iconUrl: '', sortOrder: def.sortOrder, status: 'ACTIVE' },
        })
      : await prisma.category.create({
          data: { name: def.name, iconUrl: '', sortOrder: def.sortOrder, status: 'ACTIVE' },
        });
    categoryMap.set(slug, cat.id);
  }
  console.log(`  ✅ ${categoryMap.size} food categories ensured: ${Object.keys(CATEGORY_DEFS).join(', ')}`);

  // 3. upsert 商品 + 2 SKU + 3×2 stock（by name.en + shopId 去重）
  let created = 0;
  let skipped = 0;
  for (const p of CLIENT_PRODUCTS) {
    const existingProduct = await prisma.product.findFirst({
      where: { shopId: shop.id, name: { path: ['en'], equals: p.name.en } },
    });
    if (existingProduct) {
      // 已存在则跳过（保护手动修改过的价格/库存）
      skipped++;
      continue;
    }

    const categoryId = categoryMap.get(p.category) ?? null;
    const isOutOfStock = p.stock === 0;
    const priceCents = yuanToCents(p.price);
    const largePriceCents = Math.round(priceCents * 1.8);

    // 4 语言：en/zh 来自前端，id/pt 用 en 兜底（前端无印尼语/葡语）
    const nameI18n = i18n(p.name.en, p.name.zh, p.name.en, p.name.en);
    const descI18n = p.description
      ? i18n(p.description.en, p.description.zh, p.description.en, p.description.en)
      : i18n('', '', '', '');

    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId,
        name: nameI18n,
        description: descI18n,
        mainImage: p.image,
        images: [p.image],
        status: isOutOfStock ? 'OUT_OF_STOCK' : 'ACTIVE',
        unit: UNIT_PACK,
        priceMin: priceCents, // Small SKU 价格（创建后由 sku 聚合更新）
        salesCount: p.salesCount,
      },
    });

    // 2 SKU（Standard + Family，与主 seed.ts 的 Small/Large 模式一致）
    const skuSmall = await prisma.sku.create({
      data: {
        productId: product.id,
        name: i18n(`${p.name.en} (Standard)`, `${p.name.zh}（标准装）`, `${p.name.en} (Standard)`, `${p.name.en} (Standard)`),
        attributes: [{ name: 'size', value: 'standard', valueId: 'size-standard' }],
        price: priceCents,
        status: 'ACTIVE',
      },
    });
    const skuLarge = await prisma.sku.create({
      data: {
        productId: product.id,
        name: i18n(`${p.name.en} (Family)`, `${p.name.zh}（家庭装）`, `${p.name.en} (Family)`, `${p.name.en} (Family)`),
        attributes: [{ name: 'size', value: 'family', valueId: 'size-family' }],
        price: largePriceCents,
        status: 'ACTIVE',
      },
    });

    // priceMin 取两 SKU 最低
    await prisma.product.update({
      where: { id: product.id },
      data: { priceMin: Math.min(skuSmall.price, skuLarge.price) },
    });

    // stock 分配：前端总 stock → Standard 60% + Family 40%，余数补前几个仓库（修两次 floor 损耗）
    const dist = distributeStock(p.stock, warehouses.length);
    for (const [idx, wh] of warehouses.entries()) {
      await prisma.stock.create({
        data: { warehouseId: wh.id, skuId: skuSmall.id, quantity: dist.small[idx], safetyStock: 5 },
      });
      await prisma.stock.create({
        data: { warehouseId: wh.id, skuId: skuLarge.id, quantity: dist.large[idx], safetyStock: 3 },
      });
    }

    created++;
    console.log(`  ➕ ${p.id} ${p.name.en} [${p.category}] stock=${p.stock} ${isOutOfStock ? '(OUT_OF_STOCK)' : ''}`);
  }

  console.log(`\n  ✅ ${created} products created, ${skipped} skipped (already exist)`);
  console.log(`  📦 each: 1 Product + 2 SKU + ${warehouses.length * 2} stock`);
  console.log('\n🎉 Client food seed completed!');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
