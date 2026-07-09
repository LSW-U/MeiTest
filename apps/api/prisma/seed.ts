/**
 * MeiMart 种子数据脚本
 *
 * 用法：pnpm --filter @meimart/api db:seed
 *
 * 数据范围：
 *   - 1 个 super_admin（密码登录测试账号）
 *   - 1 条 shop（单一商家预置）
 *   - 3 个 warehouses（Dili / Baucau / Maliana，含 PostGIS Point + Polygon）
 *   - 10 个 products（4 语言 i18n）+ 20 个 SKUs
 *   - 60 条 stock（每个 SKU × 3 warehouse）
 *
 * 决策依据：W1-D2-T5 + CLAUDE.md §测试阶段 OTP（密码主登录，bcrypt 哈希）
 */
import { PrismaClient } from '../src/prisma/client';
import bcrypt from 'bcryptjs';
import { setWarehouseGeometry, buildBoxPolygon } from '../src/shared/db/postgis-helpers';

const prisma = new PrismaClient();

/** 测试密码：admin12345（dev only，密码强度 ≥ 8 位 + 字母 + 数字）
 *  bcrypt cost=12（OWASP 2023 推荐 ≥12） */
const SEED_PASSWORD_HASH = bcrypt.hashSync('admin12345', 12);
const SEED_ADMIN_PHONE = '+670999999999';

/** i18n 助手：构造 4 语言字段 */
function i18n(en: string, zh: string, id: string, pt: string): Record<string, string> {
  return { en, zh, id, pt };
}

/** 3 个仓库真实东帝汶坐标 + 覆盖范围 */
const WAREHOUSES = [
  {
    code: 'W01',
    name: i18n('Dili Warehouse', '帝力仓库', 'Gudang Dili', 'Armazém Dili'),
    address: 'Rua dos Martires da Patria, Dili',
    center: { lon: 125.56, lat: -8.5568 },
    coverage: buildBoxPolygon(125.56, -8.5568, 0.2),
    deliveryFee: 500,
  },
  {
    code: 'W02',
    name: i18n('Baucau Warehouse', '包考仓库', 'Gudang Baucau', 'Armazém Baucau'),
    address: 'Avenida Baucau, Baucau',
    center: { lon: 126.45, lat: -8.4667 },
    coverage: buildBoxPolygon(126.45, -8.4667, 0.2),
    deliveryFee: 600,
  },
  {
    code: 'W03',
    name: i18n('Maliana Warehouse', '马利亚纳仓库', 'Gudang Maliana', 'Armazém Maliana'),
    address: 'Rua Principal, Maliana',
    center: { lon: 125.3833, lat: -8.9167 },
    coverage: buildBoxPolygon(125.3833, -8.9167, 0.2),
    deliveryFee: 700,
  },
] as const;

/**
 * 商品数据来源：prisma/seed-images/seed-data.json
 * 由 prisma/seed-images/upload-to-minio.mjs 生成（图片已上传 MinIO）
 *
 * 数据范围：40 个商品 × 2 SKUs × 3 warehouses = 240 stock records
 * 4 个分类：Food & Grocery / Beauty / Skin Care / Fragrances
 */
import seedDataRaw from './seed-images/seed-data.json';
const seedData = seedDataRaw as any[];

/** DummyJSON 品类 -> 分类 icon 映射 */
const CATEGORY_ICONS: Record<string, string> = {
  groceries: '🛒',
  beauty: '💄',
  'skin-care': '🧴',
  fragrances: '🌸',
};

async function main() {
  console.log('🌱 Seeding MeiMart dev database...');

  // 清空可能重复的数据（dev 脚本可重跑，幂等）
  // FK 约束顺序：order_items -> cart_items -> stock_log -> stock -> sku -> product
  await prisma.orderItem.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.stockLog.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.sku.deleteMany();
  await prisma.product.deleteMany();

  // ===== 1. super_admin =====
  const admin = await prisma.user.upsert({
    where: { phone: '+670999999999' },
    update: {
      password: SEED_PASSWORD_HASH, // dev 每次重 hash，确保用最新 BCRYPT_COST
      role: 'SUPER_ADMIN', // 防 DB 被测试/迁移改坏，每次 re-seed 强制复位
      status: 'ACTIVE',
    },
    create: {
      phone: '+670999999999',
      email: 'admin@meimart.dev',
      password: SEED_PASSWORD_HASH,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      phoneVerified: true,
      emailVerified: true,
    },
  });
  console.log(`  ✅ super_admin: ${admin.email} (phone: ${admin.phone})`);

  // ===== 1b. customer（联调用测试账号，W5-prepare） =====
  const customer = await prisma.user.upsert({
    where: { phone: '+67088888888' },
    update: { password: SEED_PASSWORD_HASH },
    create: {
      phone: '+67088888888',
      email: 'customer@meimart.dev',
      password: SEED_PASSWORD_HASH,
      name: 'Test Customer',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      phoneVerified: true,
      emailVerified: true,
    },
  });
  console.log(`  ✅ customer: ${customer.email} (phone: ${customer.phone})`);

  // ===== 2. shop（单一商家） =====
  const shop = await prisma.shop.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: i18n('MeiMart', '美超市', 'MeiMart', 'MeiMart'),
      announcement: i18n('Welcome to MeiMart', '欢迎光临美超市', 'Selamat datang di MeiMart', 'Bem-vindo ao MeiMart'),
      phone: '+6703333333',
      address: 'Avenida bispo medeiros, Dili, Timor-Leste',
      lat: -8.5568,
      lng: 125.56,
      status: 'ACTIVE',
      businessHours: {
        mon: { open: '08:00', close: '22:00' },
        tue: { open: '08:00', close: '22:00' },
        wed: { open: '08:00', close: '22:00' },
        thu: { open: '08:00', close: '22:00' },
        fri: { open: '08:00', close: '22:00' },
        sat: { open: '08:00', close: '22:00' },
        sun: { open: '08:00', close: '22:00' },
      },
    },
  });
  console.log(`  ✅ shop: ${(shop.name as Record<string, string>).en}`);

  // ===== 3. warehouses（含 PostGIS Point + Polygon） =====
  for (const w of WAREHOUSES) {
    const created = await prisma.warehouse.upsert({
      where: { code: w.code },
      update: {},
      create: {
        code: w.code,
        name: w.name,
        shopId: shop.id,
        address: w.address,
        centerLat: w.center.lat,
        centerLng: w.center.lon,
        operatingHours: {
          mon: { open: '08:00', close: '22:00' },
          tue: { open: '08:00', close: '22:00' },
          wed: { open: '08:00', close: '22:00' },
          thu: { open: '08:00', close: '22:00' },
          fri: { open: '08:00', close: '22:00' },
          sat: { open: '08:00', close: '22:00' },
          sun: { open: '08:00', close: '22:00' },
        },
        deliveryFee: w.deliveryFee,
        status: 'ACTIVE',
      },
    });
    // 用 PostGIS helper 写入 geometry 字段（prisma 直接写不支持）
    await setWarehouseGeometry(prisma, created.id, w.center, w.coverage);
    console.log(`  ✅ warehouse ${w.code}: ${w.name.en} (geometry set)`);
  }

  // ===== 4. products + skus + stock（基于 seed-data.json，含真实图片 URL） =====
  const warehouses = await prisma.warehouse.findMany();

  // 4a. 创建分类（按 seed-data.json 中的品类去重）
  await prisma.category.deleteMany();
  const categoryMap = new Map<string, string>(); // category slug -> categoryId
  const uniqueCategories = [...new Set(seedData.map((p: any) => p.category))];
  for (const catSlug of uniqueCategories) {
    const sample = seedData.find((p: any) => p.category === catSlug) as any;
    const cat = await prisma.category.create({
      data: {
        name: sample.categoryName,
        iconUrl: CATEGORY_ICONS[catSlug] ?? '📦',
        sortOrder: sample.categorySortOrder,
      },
    });
    categoryMap.set(catSlug, cat.id);
  }
  console.log(`  ✅ ${uniqueCategories.length} categories: ${uniqueCategories.join(', ')}`);

  // 4b. 创建商品 + SKU + stock
  for (const [idx, p] of seedData.entries()) {
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: categoryMap.get(p.category) ?? null,
        name: p.name, // 4 语言简短商品名（apply-translations.mjs 填充）
        description: p.description,
        mainImage: p.mainImage,
        images: p.images,
        status: 'ACTIVE',
        unit: p.unit,
        priceMin: 0, // 占位，下面 Sku 创建后更新
        salesCount: Math.floor(Math.random() * 500),
      },
    });

    // 2 个 SKU per product（小包装 + 大包装）
    const productTitle: string = p.title?.en ?? (typeof p.title === 'string' ? p.title : 'Product');
    const productTitleZh: string = p.title?.zh ?? productTitle;
    const skuSmall = await prisma.sku.create({
      data: {
        productId: product.id,
        name: i18n(`${productTitle} (Small)`, `${productTitleZh}（小）`, `${productTitle} (Small)`, `${productTitle} (Pequeno)`),
        attributes: [{ name: 'size', value: 'small', valueId: 'size-small' }],
        price: p.priceMin,
        status: 'ACTIVE',
      },
    });
    const skuLarge = await prisma.sku.create({
      data: {
        productId: product.id,
        name: i18n(`${productTitle} (Large)`, `${productTitleZh}（大）`, `${productTitle} (Large)`, `${productTitle} (Grande)`),
        attributes: [{ name: 'size', value: 'large', valueId: 'size-large' }],
        price: Math.round(p.priceMin * 1.8),
        status: 'ACTIVE',
      },
    });

    // 更新 product.priceMin
    await prisma.product.update({
      where: { id: product.id },
      data: { priceMin: Math.min(skuSmall.price, skuLarge.price) },
    });

    // 每个 SKU × 3 仓库 = stock
    for (const wh of warehouses) {
      await prisma.stock.create({
        data: {
          warehouseId: wh.id,
          skuId: skuSmall.id,
          quantity: 50 + Math.floor(Math.random() * 100),
          safetyStock: 10,
        },
      });
      await prisma.stock.create({
        data: {
          warehouseId: wh.id,
          skuId: skuLarge.id,
          quantity: 30 + Math.floor(Math.random() * 80),
          safetyStock: 5,
        },
      });
    }
  }
  console.log(`  ✅ ${seedData.length} products × 2 SKUs × ${warehouses.length} warehouses = ${seedData.length * 2 * warehouses.length} stock records`);

  // === FLOW M === 平台系统配置（流程 M 独占段，其他流程不动此段）
  // W2-COLLABORATION.md §3.5 — seed.ts 用 FLOW 注释分段
  const SYSTEM_CONFIGS: Array<{ key: string; value: string; description: string }> = [
    {
      key: 'platform.commission_rate',
      value: '5',
      description: 'Platform commission rate (%) — applied to merchant settlement',
    },
    {
      key: 'platform.currency',
      value: 'USD',
      description: 'Settlement currency (ISO 4217)',
    },
    {
      key: 'delivery.base_fee',
      value: '500',
      description: 'Delivery base fee in cents (per warehouse.surcharge added on top)',
    },
    {
      key: 'delivery.per_km_fee',
      value: '50',
      description: 'Per-km surcharge in cents (added on top of base fee)',
    },
    {
      key: 'delivery.min_order_amount',
      value: '1000',
      description: 'Minimum order amount in cents; below this order is rejected at checkout',
    },
    {
      key: 'rider.per_order_commission',
      value: '300',
      description: 'Per-order rider commission in cents (distance bonus added on top)',
    },
    {
      key: 'rider.per_km_bonus',
      value: '20',
      description: 'Per-km distance bonus in cents',
    },
    {
      key: 'order.pending_timeout_min',
      value: '15',
      description: 'Minutes before PENDING_PAYMENT order auto-cancels (BullMQ delay)',
    },
    {
      key: 'order.confirm_timeout_min',
      value: '30',
      description: 'Minutes before PENDING_CONFIRM order is flagged as abnormal',
    },
  ];

  for (const cfg of SYSTEM_CONFIGS) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: {}, // 不覆盖业务方手改的值
      create: { ...cfg, updatedBy: admin.id },
    });
  }
  console.log(`  ✅ system_configs: ${SYSTEM_CONFIGS.length} keys (commission / delivery / rider / order timeouts)`);
  // === END FLOW M ===

  // === FLOW W === W 流程扩展（2026-06-24）：地址 / 收藏 / 通知 / Banner
  // 注：分类已在 4a 步骤创建，此处不再重复
  console.log('\n📦 W 流程扩展数据...');

  const adminUser = await prisma.user.findUnique({ where: { phone: SEED_ADMIN_PHONE } });
  const allProducts = await prisma.product.findMany({ take: 5 });
  if (adminUser && allProducts.length > 0) {
    // 7.1 收货地址（2 条，1 默认）
    await prisma.address.deleteMany({ where: { userId: adminUser.id } });
    await prisma.address.create({
      data: {
        userId: adminUser.id,
        name: 'Alice Home',
        phone: '+67077777777',
        region: { province: 'Dili', city: 'Dili', district: 'Vera Cruz' },
        detail: 'Rua dos Martires da Patria, No. 12',
        lat: -8.5568,
        lng: 125.56,
        isDefault: true,
        tag: 'home',
      },
    });
    await prisma.address.create({
      data: {
        userId: adminUser.id,
        name: 'Office',
        phone: '+67077777777',
        region: { province: 'Dili', city: 'Dili', district: 'Colmera' },
        detail: 'Avenida Bispo de Medeiros, Edificio 3',
        lat: -8.5485,
        lng: 125.5725,
        isDefault: false,
        tag: 'work',
      },
    });

    // 7.2 收藏（前 3 个商品）
    await prisma.favorite.deleteMany({ where: { userId: adminUser.id } });
    for (const p of allProducts.slice(0, 3)) {
      await prisma.favorite.create({ data: { userId: adminUser.id, productId: p.id } });
    }

    // 7.3 通知（2 条未读）
    await prisma.notification.deleteMany({ where: { userId: adminUser.id } });
    await prisma.notification.create({
      data: {
        userId: adminUser.id,
        type: 'SYSTEM',
        title: { en: 'Welcome to MeiMart!', zh: '欢迎来到美超市!' },
        content: {
          en: 'Enjoy your shopping.',
          zh: '祝您购物愉快。',
        },
        isRead: false,
      },
    });
    await prisma.notification.create({
      data: {
        userId: adminUser.id,
        type: 'PROMOTION',
        title: { en: 'Free delivery this week', zh: '本周免配送费' },
        content: {
          en: 'On orders over 5000 cents.',
          zh: '订单满 50 元免配送费。',
        },
        isRead: false,
      },
    });

    console.log('  ✅ 2 addresses + 3 favorites + 2 notifications');
  }

  // 7.4 分类已在 4a 步骤创建，跳过旧的手动分类逻辑

  // 7.5 Banner（2 个 ACTIVE，使用真实商品图）
  await prisma.banner.deleteMany();
  await prisma.banner.create({
    data: {
      imageUrl: allProducts[0]?.mainImage ?? 'https://example.com/banner-promo-1.png',
      alt: { en: 'Summer Sale', zh: '夏季大促' },
      linkType: 'PRODUCT',
      linkValue: allProducts[0]?.id ?? null,
      sortOrder: 1,
      status: 'ACTIVE',
    },
  });
  await prisma.banner.create({
    data: {
      imageUrl: allProducts[1]?.mainImage ?? 'https://example.com/banner-free-delivery.png',
      alt: { en: 'Free Delivery', zh: '免配送费' },
      linkType: 'NONE',
      sortOrder: 2,
      status: 'ACTIVE',
    },
  });
  console.log('  ✅ 2 banners');
  // === END FLOW W ===

  console.log('\n🎉 Seed completed!');
  console.log(`   Login: phone=+670999999999, password=admin12345`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
