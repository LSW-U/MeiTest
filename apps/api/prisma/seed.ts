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

/** 10 个商品（4 语言） */
const PRODUCTS = [
  { name: i18n('Milk', '牛奶', 'Susu', 'Leite'), unit: i18n('bag', '袋', 'kantong', 'saco') },
  { name: i18n('Bread', '面包', 'Roti', 'Pão'), unit: i18n('loaf', '条', 'roti', 'pão') },
  { name: i18n('Rice', '米', 'Beras', 'Arroz'), unit: i18n('kg', '公斤', 'kg', 'kg') },
  { name: i18n('Water', '矿泉水', 'Air mineral', 'Água mineral'), unit: i18n('bottle', '瓶', 'botol', 'garrafa') },
  { name: i18n('Orange Juice', '橙汁', 'Jus jeruk', 'Sumo de laranja'), unit: i18n('box', '盒', 'kotak', 'caixa') },
  { name: i18n('Coca Cola', '可口可乐', 'Coca Cola', 'Coca Cola'), unit: i18n('can', '罐', 'kaleng', 'lata') },
  { name: i18n('Biscuits', '饼干', 'Biskuit', 'Bolachas'), unit: i18n('pack', '包', 'pak', 'pacote') },
  { name: i18n('Eggs', '鸡蛋', 'Telur', 'Ovos'), unit: i18n('dozen', '打', 'lusin', 'dúzia') },
  { name: i18n('Sugar', '糖', 'Gula', 'Açúcar'), unit: i18n('kg', '公斤', 'kg', 'kg') },
  { name: i18n('Salt', '盐', 'Garam', 'Sal'), unit: i18n('kg', '公斤', 'kg', 'kg') },
] as const;

async function main() {
  console.log('🌱 Seeding MeiMart dev database...');

  // 清空可能重复的数据（dev 脚本可重跑，幂等）
  // FK 约束顺序：stock → sku → product, cart_item → cart → user
  await prisma.stockLog.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.sku.deleteMany();
  await prisma.product.deleteMany();

  // ===== 1. super_admin =====
  const admin = await prisma.user.upsert({
    where: { phone: '+670999999999' },
    update: { password: SEED_PASSWORD_HASH }, // dev 每次重 hash，确保用最新 BCRYPT_COST
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

  // ===== 4. products + skus =====
  const warehouses = await prisma.warehouse.findMany();
  for (const [idx, p] of PRODUCTS.entries()) {
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        name: p.name,
        description: i18n(`Description for ${p.name.en}`, `${p.name.zh}描述`, `Deskripsi ${p.name.id}`, `Descrição ${p.name.pt}`),
        mainImage: `https://picsum.photos/seed/meimart-${idx}/400/400`,
        images: [`https://picsum.photos/seed/meimart-${idx}/400/400`],
        status: 'ACTIVE',
        unit: p.unit,
        priceMin: 0, // 占位，下面 Sku 创建后更新
        salesCount: Math.floor(Math.random() * 500),
      },
    });

    // 2 个 SKU per product（小包装 + 大包装）
    const skuSmall = await prisma.sku.create({
      data: {
        productId: product.id,
        name: i18n(`${p.name.en} (Small)`, `${p.name.zh}（小）`, `${p.name.id} (Kecil)`, `${p.name.pt} (Pequeno)`),
        attributes: [{ name: 'size', value: 'small', valueId: 'size-small' }],
        price: 200 + idx * 50,
        status: 'ACTIVE',
      },
    });
    const skuLarge = await prisma.sku.create({
      data: {
        productId: product.id,
        name: i18n(`${p.name.en} (Large)`, `${p.name.zh}（大）`, `${p.name.id} (Besar)`, `${p.name.pt} (Grande)`),
        attributes: [{ name: 'size', value: 'large', valueId: 'size-large' }],
        price: 500 + idx * 100,
        status: 'ACTIVE',
      },
    });

    // 更新 product.priceMin（取最小 SKU 价）
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
  console.log(`  ✅ ${PRODUCTS.length} products × 2 SKUs × ${warehouses.length} warehouses = ${PRODUCTS.length * 2 * warehouses.length} stock records`);

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
