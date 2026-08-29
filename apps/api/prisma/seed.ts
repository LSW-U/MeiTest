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
const SEED_ADMIN_PHONE = '+67099999999';

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

/**
 * DummyJSON 品类 -> 分类 icon 映射
 *
 * W7-ext-A 修复：原值是 emoji（🛒/💄），前端 <img src={emoji}> 会 404。
 * 改为空字符串，前端检测到非 URL 时 fallback 到 🗂 占位。
 * 后端 schema 也加了 z.string().url() 校验，禁止 emoji 当 iconUrl 写库。
 */
const CATEGORY_ICONS: Record<string, string> = {
  groceries: '',
  beauty: '',
  'skin-care': '',
  fragrances: '',
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
    where: { phone: '+67099999999' },
    update: {
      password: SEED_PASSWORD_HASH, // dev 每次重 hash，确保用最新 BCRYPT_COST
      role: 'SUPER_ADMIN', // 防 DB 被测试/迁移改坏，每次 re-seed 强制复位
      status: 'ACTIVE',
    },
    create: {
      phone: '+67099999999',
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

  // 4a. 创建分类：4 顶级大类 + 每大类下子分类（§6.1，演示两层；商品挂叶子子分类）
  await prisma.category.deleteMany();
  const TOP_CATEGORIES = [
    { slug: 'groceries', name: { en: 'Food & Grocery', zh: '食品杂货', id: 'Bahan Makanan', pt: 'Mercearia' }, sortOrder: 1 },
    { slug: 'beauty', name: { en: 'Beauty', zh: '美妆', id: 'Kecantikan', pt: 'Beleza' }, sortOrder: 2 },
    { slug: 'skin-care', name: { en: 'Skin Care', zh: '护肤', id: 'Perawatan Kulit', pt: 'Cuidados de Pele' }, sortOrder: 3 },
    { slug: 'fragrances', name: { en: 'Fragrances', zh: '香水', id: 'Parfum', pt: 'Perfumes' }, sortOrder: 4 },
  ];
  const topIdBySlug = new Map<string, string>();
  for (const t of TOP_CATEGORIES) {
    const cat = await prisma.category.create({ data: { name: t.name, iconUrl: '', sortOrder: t.sortOrder } });
    topIdBySlug.set(t.slug, cat.id);
  }
  // 子分类（§6.1：每大类下 3-4 个，name 用多语言而非顶级名重复）
  const SUB_CATEGORIES_DEF = [
    { parentSlug: 'groceries', slug: 'fresh-produce', name: { en: 'Fresh Produce', zh: '生鲜果蔬', id: 'Produk Segar', pt: 'Produtos Frescos' }, sortOrder: 1 },
    { parentSlug: 'groceries', slug: 'pantry', name: { en: 'Pantry Staples', zh: '粮油干货', id: 'Bahan Pokok', pt: 'Despensa' }, sortOrder: 2 },
    { parentSlug: 'groceries', slug: 'snacks', name: { en: 'Snacks', zh: '零食', id: 'Camilan', pt: 'Lanches' }, sortOrder: 3 },
    { parentSlug: 'groceries', slug: 'beverages', name: { en: 'Beverages', zh: '饮料', id: 'Minuman', pt: 'Bebidas' }, sortOrder: 4 },
    { parentSlug: 'beauty', slug: 'skincare', name: { en: 'Skincare', zh: '护肤', id: 'Perawatan Wajah', pt: 'Cuidados Rosto' }, sortOrder: 1 },
    { parentSlug: 'beauty', slug: 'makeup', name: { en: 'Makeup', zh: '彩妆', id: 'Makeup', pt: 'Maquiagem' }, sortOrder: 2 },
    { parentSlug: 'beauty', slug: 'body-care', name: { en: 'Body Care', zh: '身体护理', id: 'Perawatan Tubuh', pt: 'Cuidados Corpo' }, sortOrder: 3 },
    { parentSlug: 'skin-care', slug: 'face-care', name: { en: 'Face Care', zh: '面部护理', id: 'Perawatan Wajah', pt: 'Cuidados Rosto' }, sortOrder: 1 },
    { parentSlug: 'skin-care', slug: 'sun-care', name: { en: 'Sun Care', zh: '防晒', id: 'Tabir Surya', pt: 'Proteção Solar' }, sortOrder: 2 },
    { parentSlug: 'fragrances', slug: 'women', name: { en: 'Women', zh: '女士', id: 'Wanita', pt: 'Mulher' }, sortOrder: 1 },
    { parentSlug: 'fragrances', slug: 'men', name: { en: 'Men', zh: '男士', id: 'Pria', pt: 'Homem' }, sortOrder: 2 },
    { parentSlug: 'fragrances', slug: 'unisex', name: { en: 'Unisex', zh: '中性', id: 'Unisex', pt: 'Unisex' }, sortOrder: 3 },
  ];
  // 每大类的子分类 id 列表（商品按 index 轮流分配，演示子分类有商品）
  const subIdsByParent = new Map<string, string[]>();
  for (const s of SUB_CATEGORIES_DEF) {
    const parentTopId = topIdBySlug.get(s.parentSlug)!;
    const cat = await prisma.category.create({
      data: { name: s.name, iconUrl: CATEGORY_ICONS[s.slug] ?? '', sortOrder: s.sortOrder, parentId: parentTopId },
    });
    if (!subIdsByParent.has(s.parentSlug)) subIdsByParent.set(s.parentSlug, []);
    subIdsByParent.get(s.parentSlug)!.push(cat.id);
  }
  console.log(`  ✅ ${TOP_CATEGORIES.length} 顶级 + ${SUB_CATEGORIES_DEF.length} 子分类`);

  // 4b. 创建商品 + SKU + stock（💭-4: 用大类内 index 分配子分类，不依赖 seedData 按 category 分组连续）
  const __categoryCounter = new Map<string, number>();
  for (const p of seedData) {
    const __withinCat = __categoryCounter.get(p.category) ?? 0;
    __categoryCounter.set(p.category, __withinCat + 1);
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: (() => {
          const subs = subIdsByParent.get(p.category);
          return subs && subs.length ? subs[__withinCat % subs.length] : null;
        })(),
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
    // P2-1/P2-3 修复（2026-08-27 审查报告）：删 delivery.base_fee / per_km_fee / min_order_amount 三条死配置
    //   计费参数已迁移到 warehouse.deliveryFee / perKmFee / freeKm 真字段（distance fee 改造）
    //   checkMinOrder 起送价校验本期不生效（DEFAULT_MIN_ORDER_AMOUNT=0），保留这三条会误导运营以为生效
    //   运营改这三条 key 不生效 → 删除避免混淆（admin-web settings 页 minOrderAmount 列读 listWarehousePricingConfig，不读 system_config）
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
    {
      // P5 #1 客服热线配置下发（2026-08-25）：骑手/客户端 help 页从后端读，避免硬编码
      key: 'support.phone',
      value: '+6707700000',
      description: 'Customer support hotline (E.164-ish, displayed on help page; admin editable)',
    },
    {
      // P5 #1 客服热线配置下发：客服工作时间（help 页展示，admin 可改）
      key: 'support.hours',
      value: 'Mon-Sun 08:00-20:00',
      description: 'Customer support working hours (display only)',
    },
    {
      // P25 #2 关于页社交链接配置下发（2026-08-25）：about 页 socials 从 SystemConfig 读
      // value 为 JSON 字符串数组 [{type,url}]，type ∈ facebook/whatsapp/instagram
      // host 白名单在后端 AboutService 校验；运营改此 key 即可更新社交链接
      key: 'about.socials',
      value: JSON.stringify([
        { type: 'whatsapp', url: 'https://wa.me/67077000000' },
        { type: 'facebook', url: 'https://facebook.com/meimart' },
        { type: 'instagram', url: 'https://instagram.com/meimart' },
      ]),
      description: 'About page social links (JSON array of {type,url}; type ∈ facebook/whatsapp/instagram)',
    },
    // 应用中心配置（admin-web 优化方案 批次3，2026-08-29）
    // SystemConfigService.update 是 update-only（key 不存在 → E-PLATFORM-002），故 app.* key 必须由 seed 预置。
    // value 一律空字符串：对应 /apps 页「未配置」空态，运营首次保存即填值（upsert update:{} 不覆盖已有值）。
    // key 白名单与 admin-web use-apps.ts APP_CONFIG_KEYS 完全对齐（客户端 5 + 骑手 5）。
    {
      key: 'app.client.ios.url',
      value: '',
      description: 'Client App iOS download URL (admin-web /apps page, first-save fills value)',
    },
    {
      key: 'app.client.android.url',
      value: '',
      description: 'Client App Android download URL (admin-web /apps page)',
    },
    {
      key: 'app.client.qr',
      value: '',
      description: 'Client App download QR image URL (admin-web /apps page)',
    },
    {
      key: 'app.client.version',
      value: '',
      description: 'Client App latest version string (admin-web /apps page)',
    },
    {
      key: 'app.client.changelog',
      value: '',
      description: 'Client App changelog text (admin-web /apps page)',
    },
    {
      key: 'app.rider.ios.url',
      value: '',
      description: 'Rider App iOS download URL (admin-web /apps page)',
    },
    {
      key: 'app.rider.android.url',
      value: '',
      description: 'Rider App Android download URL (admin-web /apps page)',
    },
    {
      key: 'app.rider.qr',
      value: '',
      description: 'Rider App download QR image URL (admin-web /apps page)',
    },
    {
      key: 'app.rider.version',
      value: '',
      description: 'Rider App latest version string (admin-web /apps page)',
    },
    {
      key: 'app.rider.changelog',
      value: '',
      description: 'Rider App changelog text (admin-web /apps page)',
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

  // === P5 #3 法律文档（2026-08-25）===
  // 服务条款(TERMS)/隐私政策(PRIVACY) 正文预置，content 为多语言 JSON（en/zh/id/pt/tet）
  // MVP 无 admin 编辑后台，先 seed；同 docType 仅一条 is_active=true（DB 部分唯一索引兜底）
  console.log('\n📄 法律文档（TERMS / PRIVACY）...');
  const LEGAL_DOCS: Array<{
    docType: string;
    version: string;
    content: Record<string, string>;
  }> = [
    {
      docType: 'TERMS',
      version: '1.0.0',
      content: {
        en: 'MeiMart Terms of Service\n\n1. By using MeiMart, you agree to place orders for personal use and pay the displayed amount (including delivery fees) via the selected payment method.\n2. Orders are confirmed once accepted by the platform/warehouse. You may cancel before confirmation; after confirmation, cancellation is subject to the refund policy.\n3. Cash-on-delivery orders must be paid to the rider upon receipt. Refused payment may affect future orders.\n4. We reserve the right to refuse service in cases of fraud, abuse, or violation of these terms.',
        zh: 'MeiMart 服务条款\n\n1. 使用 MeiMart 即表示您同意为个人使用下单，并按显示金额（含配送费）通过所选支付方式支付。\n2. 订单在平台/仓库确认后生效。确认前可取消；确认后取消须遵守退款政策。\n3. 货到付款订单须在收货时向骑手支付。拒付可能影响后续下单。\n4. 我们保留在欺诈、滥用或违反本条款的情况下拒绝服务的权利。',
        id: 'Syarat & Ketentuan MeiMart\n\n1. Dengan menggunakan MeiMart, Anda setuju melakukan pemesanan untuk penggunaan pribadi dan membayar sesuai jumlah yang ditampilkan (termasuk biaya pengiriman) melalui metode pembayaran yang dipilih.\n2. Pesanan dikonfirmasi setelah diterima platform/gudang. Pembatalan sebelum konfirmasi diizinkan; setelah konfirmasi tunduk pada kebijakan pengembalian dana.\n3. Pesanan bayar di tempat harus dibayar ke kurir saat diterima. Penolakan pembayaran dapat memengaruhi pesanan mendatang.\n4. Kami berhak menolak layanan dalam kasus penipuan, penyalahgunaan, atau pelanggaran ketentuan ini.',
        pt: 'Termos de Serviço MeiMart\n\n1. Ao usar MeiMart, concorda em fazer encomendas para uso pessoal e pagar o valor exibido (incluindo taxas de entrega) pelo método de pagamento selecionado.\n2. As encomendas são confirmadas após aceitação pela plataforma/armazém. Pode cancelar antes da confirmação; após confirmação, está sujeito à política de reembolso.\n3. Encomendas pagamento na entrega devem ser pagas ao estafeta na receção. Recusa de pagamento pode afetar encomendas futuras.\n4. Reservamo-nos o direito de recusar serviço em casos de fraude, abuso ou violação destes termos.',
        tet: 'MeiMart Terms of Service\n\n1. Uza MeiMart signifika ita konfirma hatutan order ba uza pessoál no halo pagamentu tuir valor hatudu (inklui taxa entrega) liu husi métodu pagamentu nebe ita hili.\n2. Order konfirma depois plataforma/armazem simu. bele kansa antes konfirma; depois konfirma submete ba polítika refundo.\n3. Order bayar iha lokal tenke bayar ba rider bainhira simu. labele bayare bele afeta order futuru.',
      },
    },
    {
      docType: 'PRIVACY',
      version: '1.0.0',
      content: {
        en: 'MeiMart Privacy Policy\n\n1. We collect your phone number, name, delivery address, and order history solely to fulfil orders and provide support.\n2. We do not sell your personal data. Location data is used only for active deliveries and is not stored beyond the delivery period.\n3. Payment credentials are handled by third-party providers; we do not store full card or account details.\n4. You may request data deletion by contacting support; we will process it within a reasonable period.',
        zh: 'MeiMart 隐私政策\n\n1. 我们仅收集您的手机号、姓名、收货地址和订单历史，用于完成订单和提供客服支持。\n2. 我们不会出售您的个人数据。位置数据仅用于进行中的配送，配送结束后不再保留。\n3. 支付凭证由第三方支付商处理；我们不存储完整的卡号或账户信息。\n4. 您可联系客服申请删除数据；我们将在合理期限内处理。',
        id: 'Kebijakan Privasi MeiMart\n\n1. Kami mengumpulkan nomor telepon, nama, alamat pengiriman, dan riwayat pesanan Anda semata-mata untuk memenuhi pesanan dan memberikan dukungan.\n2. Kami tidak menjual data pribadi Anda. Data lokasi hanya digunakan untuk pengiriman aktif dan tidak disimpan setelah periode pengiriman.\n3. Kredensial pembayaran ditangani oleh penyedia pihak ketiga; kami tidak menyimpan detail kartu atau akun lengkap.\n4. Anda dapat meminta penghapusan data dengan menghubungi dukungan; kami akan memprosesnya dalam waktu yang wajar.',
        pt: 'Política de Privacidade MeiMart\n\n1. Recolhemos o seu número de telefone, nome, endereço de entrega e histórico de encomendas apenas para cumprir encomendas e fornecer suporte.\n2. Não vendemos os seus dados pessoais. Os dados de localização são usados apenas para entregas ativas e não são guardados após o período de entrega.\n3. As credenciais de pagamento são tratadas por fornecedores terceiros; não armazenamos detalhes completos de cartão ou conta.\n4. Pode solicitar a eliminação de dados contactando o suporte; processaremos dentro de um prazo razoável.',
        tet: 'MeiMart Privacy Policy\n\n1. Ami hetan numeru telefone, naran, moris adresu, no istoria order deit atu kumpre order no fornese suporte.\n2. Ami la faan dados pessoál. dados lokalizasaun uza deit ba entrega ativa no la keeps depois periodo entrega.\n3. Kredensial pagamentu tabeke husi provider parte sira-tolu; ami la keeps kartun ka konta detalle kompleto.',
      },
    },
    {
      // P25 #1 营业资质（LICENSE）正文预置（2026-08-25）：三类法务文案同源补齐
      docType: 'LICENSE',
      version: '1.0.0',
      content: {
        en: 'MeiMart Business License\n\nMeiMart is a local e-commerce platform serving Timor-Leste, operated by MeiMart Lda. We are committed to lawful operation and are completing the registration of the required business licenses with the relevant Timor-Leste authorities. During the MVP launch period, operations are conducted under personal accounts; formal business licensing will be completed before full-scale operations. For verification or partnership inquiries, please contact support.',
        zh: 'MeiMart 营业资质\n\nMeiMart 是服务东帝汶的本地电商平台，由 MeiMart Lda. 运营。我们承诺合法经营，正在向东帝汶相关主管部门办理所需的营业资质登记。MVP 上线阶段以个人账号运营，正式营业资质将在全面运营前补齐。如需核验或合作咨询，请联系客服。',
        id: 'Lisensi Bisnis MeiMart\n\nMeiMart adalah platform e-commerce lokal yang melayani Timor-Leste, dioperasikan oleh MeiMart Lda. Kami berkomitmen untuk beroperasi secara sah dan sedang menyelesaikan pendaftaran lisensi bisnis yang diperlukan dengan otoritas Timor-Leste yang berwenang. Selama periode peluncuran MVP, operasi dilakukan dengan akun pribadi; lisensi bisnis formal akan diselesaikan sebelum operasi skala penuh. Untuk verifikasi atau pertanyaan kemitraan, silakan hubungi dukungan.',
        pt: 'Licença de Negócio MeiMart\n\nMeiMart é uma plataforma de comércio eletrónico local que serve Timor-Leste, operada pela MeiMart Lda. Estamos comprometidos com a operação legal e estamos a concluir o registo das licenças de negócio necessárias junto das autoridades competentes de Timor-Leste. Durante o período de lançamento do MVP, as operações são realizadas com contas pessoais; o licenciamento comercial formal será concluído antes das operações em grande escala. Para verificação ou perguntas sobre parcerias, contacte o suporte.',
        tet: 'MeiMart Business License\n\nMeiMart platforma e-commerce lokal nebe servisu Timor-Leste, opera husi MeiMart Lda. Ami konfirma halo operasaun legal no remata rejistu lisensi bisnis nebe presiza hamutuk autoridade Timor-Leste. Durante periodu MVP, operasaun uza konta pessoál; lisensi bisnis formal remata antes operasaun kompletu. Atu verifika ka konsulta parceria, favur kontaktu suporte.',
      },
    },
  ];
  for (const doc of LEGAL_DOCS) {
    await prisma.legalDocument.upsert({
      where: { docType_version: { docType: doc.docType, version: doc.version } },
      update: {}, // 不覆盖已编辑版本
      create: {
        docType: doc.docType,
        version: doc.version,
        content: doc.content,
        isActive: true,
      },
    });
  }
  console.log(`  ✅ legal_documents: ${LEGAL_DOCS.length} docs (TERMS v1.0.0 / PRIVACY v1.0.0 / LICENSE v1.0.0)`);

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

  // === HotSearchTerm seed（运营种子词，热搜榜 PINNED 前置 + MANUAL 兜底）===
  // Why: 前端 Popular 区接 GET /client/search/hot，端点就绪但表空 -> 前端隐藏。
  //      seed 5 语言 × 6 词（PINNED 2 置顶 + MANUAL 4 兜底），覆盖 SUPPORTED_LANGS。
  //      ZSET 真实搜索次数累积后，PINNED + ZSET 合并（listHot service 逻辑）。
  await prisma.hotSearchTerm.deleteMany();
  const HOT_SEARCH_SEED = [
    // en
    { word: 'Apple', lang: 'en', type: 'PINNED' as const, sortOrder: 1 },
    { word: 'Milk', lang: 'en', type: 'PINNED' as const, sortOrder: 2 },
    { word: 'Oil', lang: 'en', type: 'MANUAL' as const, sortOrder: 1 },
    { word: 'Rice', lang: 'en', type: 'MANUAL' as const, sortOrder: 2 },
    { word: 'Salmon', lang: 'en', type: 'MANUAL' as const, sortOrder: 3 },
    { word: 'Eggs', lang: 'en', type: 'MANUAL' as const, sortOrder: 4 },
    // zh
    { word: '苹果', lang: 'zh', type: 'PINNED' as const, sortOrder: 1 },
    { word: '牛奶', lang: 'zh', type: 'PINNED' as const, sortOrder: 2 },
    { word: '食用油', lang: 'zh', type: 'MANUAL' as const, sortOrder: 1 },
    { word: '大米', lang: 'zh', type: 'MANUAL' as const, sortOrder: 2 },
    { word: '三文鱼', lang: 'zh', type: 'MANUAL' as const, sortOrder: 3 },
    { word: '鸡蛋', lang: 'zh', type: 'MANUAL' as const, sortOrder: 4 },
    // id（印尼语）
    { word: 'Apel', lang: 'id', type: 'PINNED' as const, sortOrder: 1 },
    { word: 'Susu', lang: 'id', type: 'PINNED' as const, sortOrder: 2 },
    { word: 'Minyak', lang: 'id', type: 'MANUAL' as const, sortOrder: 1 },
    { word: 'Beras', lang: 'id', type: 'MANUAL' as const, sortOrder: 2 },
    { word: 'Salmon', lang: 'id', type: 'MANUAL' as const, sortOrder: 3 },
    { word: 'Telur', lang: 'id', type: 'MANUAL' as const, sortOrder: 4 },
    // pt（葡语）
    { word: 'Maçã', lang: 'pt', type: 'PINNED' as const, sortOrder: 1 },
    { word: 'Leite', lang: 'pt', type: 'PINNED' as const, sortOrder: 2 },
    { word: 'Óleo', lang: 'pt', type: 'MANUAL' as const, sortOrder: 1 },
    { word: 'Arroz', lang: 'pt', type: 'MANUAL' as const, sortOrder: 2 },
    { word: 'Salmão', lang: 'pt', type: 'MANUAL' as const, sortOrder: 3 },
    { word: 'Ovos', lang: 'pt', type: 'MANUAL' as const, sortOrder: 4 },
    // tet（德顿语，英文 fallback）
    { word: 'Apple', lang: 'tet', type: 'PINNED' as const, sortOrder: 1 },
    { word: 'Milk', lang: 'tet', type: 'PINNED' as const, sortOrder: 2 },
    { word: 'Oil', lang: 'tet', type: 'MANUAL' as const, sortOrder: 1 },
    { word: 'Rice', lang: 'tet', type: 'MANUAL' as const, sortOrder: 2 },
    { word: 'Salmon', lang: 'tet', type: 'MANUAL' as const, sortOrder: 3 },
    { word: 'Eggs', lang: 'tet', type: 'MANUAL' as const, sortOrder: 4 },
  ];
  await prisma.hotSearchTerm.createMany({
    data: HOT_SEARCH_SEED.map((t) => ({ ...t, status: 'ACTIVE' })),
    skipDuplicates: true,
  });
  console.log(`  ✅ ${HOT_SEARCH_SEED.length} hot search terms (5 langs × 6: 2 PINNED + 4 MANUAL)`);

  console.log('\n🎉 Seed completed!');
  console.log(`   Login: phone=+67099999999, password=admin12345`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
