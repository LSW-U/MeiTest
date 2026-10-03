/**
 * MeiMart 商品/分类/SKU tet（德顿语）五语回填脚本（批1 B-P0-4，R10 拍板）
 *
 * 用途：给存量库（dev/staging，不经干库 seed 回放的库）补缺失的 tet 键：
 *   - products.name / products.description / products.unit
 *   - categories.name
 *   - skus.name
 *
 * 幂等规则（关键）：
 *   - 仅当 JSON 键缺失「或已有值为空串」时才写 tet；绝不覆盖已有非空值
 *     （admin CRUD 改过的分类/商品不受影响，与 seed.ts upsert 白名单惯例一致）
 *   - 可安全重跑：重跑第二遍 updated=0
 *   - 不产生空串占位：译文表内没有词条的商品跳过并在输出中提示
 *
 * 覆盖范围：主 seed 的 40 商品（by name.en，同 seed-data.json）+ 16 分类（by name.en）
 *           + client-foods 10 商品（by name.en，p001-p010 前端已有 tet 复用）+ 其 SKU。
 * admin 新录入的不在译文表内的实体不处理（欠账由 D7 admin tet 校验落地解决）。
 *
 * 用法：cd apps/api && pnpm tsx prisma/backfill-tet.ts
 * 前置：无（独立于 seed，可随时跑）
 */
import { PrismaClient } from '../src/prisma/client';

const prisma = new PrismaClient();

// ===== 译文表（与 seed-images/apply-translations.mjs TRANSLATIONS 同源，key = name.en）=====
// tet 译文为人工德顿语翻译（2026-10-03 批1；先例风格 seed-client-foods.ts / seed.ts Legal 段）
const PRODUCT_TET: Record<string, { name: string; description: string; unit: string }> = {
  Apple: { name: 'Maçã', description: 'Maçã fresu no meten, diak ba hahan sira ka farkude iha kozina.', unit: 'pakote' },
  'Beef Steak': { name: 'Bisti Baka', description: 'Bisti baka kualidade diak, diak ba suli ka nanoi tuir ita hakarak.', unit: 'pakote' },
  'Cat Food': { name: 'Hahan Busa', description: 'Hahan busa nutrisaun diak, atu preenxe presiza hahan busa lor-loron.', unit: 'pakote' },
  'Chicken Meat': { name: 'Naan Manu', description: 'Naan manu fresu no mamuk, diak ba kozina oioin.', unit: 'pakote' },
  'Cooking Oil': { name: 'Minan Tahan', description: "Minan tahan serbaguna, diak ba nana'i ka kozina hahan oioin.", unit: 'fasu' },
  Cucumber: { name: 'Pepinu', description: 'Pepinu fresu no besik, diak ba salada ka hahan.', unit: 'pakote' },
  'Dog Food': { name: 'Hahan Asu', description: 'Hahan asu espesial ho nutrisaun importante ba asu.', unit: 'pakote' },
  Eggs: { name: 'Manu Tolun', description: 'Manu tolun fresu, diak ba nanoi, kozina ka kafe daan.', unit: 'kaxa' },
  'Fish Steak': { name: 'Bisti Ikan', description: 'Bisti ikan kualidade diak, diak ba suli ka nanoi.', unit: 'pakote' },
  'Green Bell Pepper': { name: 'Pimenton Mean', description: 'Pimenton mean fresu, hamosu kor no rasa iha hahan.', unit: 'pakote' },
  'Green Chili Pepper': { name: 'Aé Mean', description: 'Aé mean mak hera, diak ba hamosu rasa hera iha hahan.', unit: 'pakote' },
  'Honey Jar': { name: 'Fuan-Fuan', description: 'Fuan-fuan naturál diak iha kaxa, diak ba hamosu rasa midar.', unit: 'toples' },
  'Ice Cream': { name: 'Ais Krim', description: 'Ais krim mamar no gosta, iha rasa oioin atu hili.', unit: 'kaxa' },
  Juice: { name: 'Sumu', description: 'Sumu ai-han fresu, ho vitamina barak, diak bedik.', unit: 'kaxa' },
  Kiwi: { name: 'Kiwi', description: 'Kiwi ho nutrisaun barak, diak ba hahan ka kozina tropikal.', unit: 'pakote' },
  Lemon: { name: 'Lemu', description: 'Lemu fresu no asam, diak ba kozina ka hamosu bedik.', unit: 'pakote' },
  Milk: { name: 'Susu', description: 'Susu fresu ho nutrisaun, hahan importante ba kozina oioin.', unit: 'fasu' },
  Mulberry: { name: 'Amora', description: 'Amora midar no fresu, diak ba hahan ka sobremesa.', unit: 'pakote' },
  'Nescafe Coffee': { name: 'Kafe Neskafe', description: 'Kafe Neskafe kualidade diak, iha roasting oioin atu hili.', unit: 'fasu' },
  Potatoes: { name: 'Batata', description: 'Batata serbaguna, diak ba suli, tee ka halo puré.', unit: 'pakote' },
  'Protein Powder': { name: 'Fuin Proteina', description: 'Fuin proteina ho nutrisaun barak, diak ba proteina lor-loron.', unit: 'toples' },
  'Red Onions': { name: 'Luan Mean', description: 'Luan mean ho aroma diak, hamosu rasa manas iha kozina.', unit: 'pakote' },
  Rice: { name: 'Holas', description: 'Holas kualidade diak, hahan boot ba kozina oioin.', unit: 'saku' },
  'Soft Drinks': { name: 'Bedik Faris', description: "Bedik faris ho rasa oioin, diak ba hasa'e luan.", unit: 'fasu' },
  Strawberry: { name: 'Mora', description: 'Mora midar no fresu, diak ba hahan ka sobremesa.', unit: 'kaxa' },
  'Tissue Paper Box': { name: 'Surat Tisu', description: 'Surat tisu prakatiku, tisu mamuk ba uza lor-loron.', unit: 'kaxa' },
  Water: { name: 'Bee Móin', description: 'Bee móin moos, importante atu horon naran lor-loron.', unit: 'fasu' },
  'Essence Mascara Lash Princess': { name: 'Maskara', description: 'Maskara Essence populár ba bulu mata boot no naruk.', unit: 'tubo' },
  'Eyeshadow Palette with Mirror': { name: 'Paleta Ain-Matin', description: 'Paleta ain-matin ho kor oioin, diak ba dekorasaun lor-loron.', unit: 'kaxa' },
  'Powder Canister': { name: 'Fuin Powdér', description: 'Fuin powdér fino atu tama dekorasaun no taka ramen.', unit: 'kaxa' },
  'Red Lipstick': { name: 'Lipstik Mean', description: 'Lipstik mean klásiku, hamosu kor nakar ba bibin.', unit: 'tubo' },
  'Red Nail Polish': { name: 'Farós Mean', description: 'Farós mean ho kilat boot, kor toma lorak.', unit: 'fasu' },
  'Attitude Super Leaves Hand Soap': { name: 'Sabun Attitude', description: 'Sabun fon naturál Attitude, mamar no nutre liman.', unit: 'fasu' },
  'Olay Ultra Moisture Shea Butter Body Wash': { name: 'Sabun-Fon Olay', description: 'Sabun-fon Olay ho manteiga karité, mamar kulit kleur.', unit: 'fasu' },
  'Vaseline Men Body and Face Lotion': { name: 'Losion Vaseline', description: 'Losion Vaseline ba mane, ba ain no oan mane nian.', unit: 'fasu' },
  'Calvin Klein CK One': { name: 'Parfum CK One', description: 'Parfum CK One klásiku unisex, aroma sítirus fresu.', unit: 'fasu' },
  'Chanel Coco Noir Eau De': { name: 'Parfum Coco Noir', description: 'Parfum Coco Noir Chanel, eleganti no mistériozu.', unit: 'fasu' },
  "Dior J'adore": { name: "Parfum J'adore Dior", description: "Parfum J'adore Dior, floral luxuozu no eleganti.", unit: 'fasu' },
  'Dolce Shine Eau de': { name: 'Parfum Dolce Shine', description: 'Parfum Dolce Shine D&G, aroma fruta mateus no naruk.', unit: 'fasu' },
  'Gucci Bloom Eau de': { name: 'Parfum Gucci Bloom', description: 'Parfum Gucci Bloom, floral no faín, aroma modernu.', unit: 'fasu' },
};

// client-foods 10 商品（p001-p010，前端 mocks 已带 tet，此处随主表统一口径；unit 统一 pakote）
const CLIENT_FOOD_TET: Record<string, { name: string; description: string; unit: string }> = {
  'Fresh Red Fuji Apple': { name: 'Maçã Fuji Vermelha Frescu', description: 'Maçã Fuji vermella fresku, moruk no meten', unit: 'pakote' },
  'Free-Range Eggs (30 pack)': { name: 'Manu Tolun 30', description: 'Tolun manu sirku livre, simu fresku', unit: 'pakote' },
  'Pearl Rice 5kg': { name: 'Horas Mutin 5kg', description: '', unit: 'saku' },
  'Cooking Oil 5L': { name: 'Minan Tahan 5L', description: '', unit: 'fasu' },
  'Pure Milk 250ml × 12': { name: 'Sasán Lét 250ml × 12', description: '', unit: 'fasu' },
  'Tsingtao Beer 500ml × 12': { name: 'Bir Tsingtao 500ml × 12', description: '', unit: 'fasu' },
  'Snacks Variety Pack': { name: 'Pakote Snack', description: '', unit: 'pakote' },
  'Toothpaste Set (3 pack)': { name: 'Pasta Ihan 3', description: '', unit: 'kaxa' },
  'Tissue Paper 24 pack': { name: 'Surat Tisu 24', description: '', unit: 'pakote' },
  'Imported Salmon 200g': { name: 'Salmaun Importadu 200g', description: '', unit: 'pakote' },
};

// 分类（主 seed 16 分类 + client-foods 9 分类，key = name.en）
const CATEGORY_TET: Record<string, string> = {
  // 主 seed 顶级
  'Food & Grocery': 'Aihan no Merkaria',
  Beauty: 'Beleza',
  'Skin Care': 'Kuidadu Kulit',
  Fragrances: 'Parfum',
  // 主 seed 子分类
  'Fresh Produce': 'Produtu Fresu',
  'Pantry Staples': 'Aihan Kunsei',
  Snacks: 'Hahan Kiak',
  Beverages: 'Bedik',
  Skincare: 'Kuidadu Kulit',
  Makeup: 'Dekorasaun',
  'Body Care': 'Kuidadu Isin',
  'Face Care': 'Kuidadu Oan',
  'Sun Care': 'Protesaun Kuak',
  Women: 'Feto',
  Men: 'Mane',
  Unisex: 'Unisex',
  // client-foods 分类
  Fruits: 'Ai-fuan',
  Eggs: 'Manu Tolun',
  Grain: 'Holas no Faín',
  'Cooking Oil': 'Minan Tahan',
  Dairy: 'Produtu Susu',
  Drinks: 'Bedik',
  Household: 'Ekipamentu Uma',
  Seafood: 'Moi Tasi',
};

/** client-foods SKU 后缀（与 seed-client-foods.ts 的 Standard/Family 命名一致） */
const SKU_SUFFIX_TET: Record<string, string> = {
  '(Standard)': '(Padraun)',
  '(Family)': '(Família)',
};

/** 主 seed SKU 后缀（Small/Large） */
const SKU_SUFFIX_MAIN: Record<string, string> = {
  '(Small)': "(Ki'ik)",
  '(Large)': "(Bo'ot)",
  '(Pequeno)': "(Ki'ik)",
  '(Grande)': "(Bo'ot)",
};

/** 判断 JSON 字段是否需要补 tet：键缺失或值为空串 */
function needsTet(json: unknown): boolean {
  if (json === null || typeof json !== 'object') return true;
  const v = (json as Record<string, string>).tet;
  return v === undefined || v === null || v === '';
}

/** 从 JSON 取 en 值（查表 key） */
function enOf(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null;
  return (json as Record<string, string>).en ?? null;
}

async function main() {
  console.log('🌱 Backfill tet (德顿语) into products / categories / skus...');

  let productUpdated = 0;
  let productSkipped = 0;
  let productNoEntry = 0;

  // ===== 1. products（name / description / unit）=====
  const products = await prisma.product.findMany();
  for (const p of products) {
    const en = enOf(p.name);
    if (!en) {
      productSkipped++;
      continue;
    }
    const entry = PRODUCT_TET[en] ?? CLIENT_FOOD_TET[en];
    if (!entry) {
      productNoEntry++;
      console.log(`  ⏭️  product 无 tet 词条（跳过，不写占位）: ${en}`);
      continue;
    }
    const data: Record<string, unknown> = {};
    const nameJson = p.name as Record<string, string>;
    const descJson = (p.description ?? {}) as Record<string, string>;
    const unitJson = p.unit as Record<string, string>;

    if (needsTet(p.name)) {
      data.name = { ...nameJson, tet: entry.name };
    }
    // description：仅当存在非空 en 内容且缺 tet 时才补（client-foods 的空描述不写占位）
    const hasDescContent = Boolean(descJson.en);
    if (p.description && hasDescContent && needsTet(p.description) && entry.description) {
      data.description = { ...descJson, tet: entry.description };
    }
    // unit：client-foods 的 unit 无 tet 译文（pack 对应 tet 常用 pakote，统一补）
    if (needsTet(p.unit)) {
      data.unit = { ...unitJson, tet: entry.unit };
    }
    if (Object.keys(data).length === 0) {
      productSkipped++;
      continue;
    }
    await prisma.product.update({ where: { id: p.id }, data });
    productUpdated++;
  }
  console.log(`  ✅ products: ${productUpdated} updated, ${productSkipped} skipped(已有 tet), ${productNoEntry} no-entry`);

  // ===== 2. categories（name）=====
  let catUpdated = 0;
  let catSkipped = 0;
  let catNoEntry = 0;
  const categories = await prisma.category.findMany();
  for (const c of categories) {
    const en = enOf(c.name);
    if (!en || !CATEGORY_TET[en]) {
      if (en && !CATEGORY_TET[en]) {
        catNoEntry++;
        console.log(`  ⏭️  category 无 tet 词条（跳过）: ${en}`);
      }
      continue;
    }
    if (!needsTet(c.name)) {
      catSkipped++;
      continue;
    }
    const nameJson = c.name as Record<string, string>;
    await prisma.category.update({
      where: { id: c.id },
      data: { name: { ...nameJson, tet: CATEGORY_TET[en] } },
    });
    catUpdated++;
  }
  console.log(`  ✅ categories: ${catUpdated} updated, ${catSkipped} skipped(已有 tet), ${catNoEntry} no-entry`);

  // ===== 3. skus（name，由商品/SKU 后缀推导 tet）=====
  let skuUpdated = 0;
  let skuSkipped = 0;
  let skuNoEntry = 0;
  const skus = await prisma.sku.findMany({ include: { product: true } });
  for (const s of skus) {
    if (!needsTet(s.name)) {
      skuSkipped++;
      continue;
    }
    const skuEn = enOf(s.name) ?? s.name;
    const prodEn = enOf(s.product.name);
    // 从 SKU en 名取括号后缀
    const suffixMatch = skuEn.match(/\(([^)]+)\)\s*$/);
    const suffix = suffixMatch ? `(${suffixMatch[1]})` : null;
    const suffixTet = suffix ? (SKU_SUFFIX_MAIN[suffix] ?? SKU_SUFFIX_TET[suffix]) : null;
    const prodTet = prodEn ? (PRODUCT_TET[prodEn]?.name ?? CLIENT_FOOD_TET[prodEn]?.name) : null;
    if (!prodTet) {
      skuNoEntry++;
      continue;
    }
    // tet SKU 名 = 商品 tet 名 + tet 后缀（无后缀则仅商品名）
    const tetName = suffixTet ? `${prodTet} ${suffixTet}` : prodTet;
    const nameJson = s.name as Record<string, string>;
    await prisma.sku.update({
      where: { id: s.id },
      data: { name: { ...nameJson, tet: tetName } },
    });
    skuUpdated++;
  }
  console.log(`  ✅ skus: ${skuUpdated} updated, ${skuSkipped} skipped(已有 tet), ${skuNoEntry} no-entry`);

  console.log(`\n🎉 Backfill tet completed（幂等：重跑应全 skipped/updated=0）`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Backfill failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
