/**
 * 上传商品图片到 MinIO 并生成 seed 数据 JSON
 *
 * 用法：node prisma/seed-images/upload-to-minio.mjs
 *
 * 输出：prisma/seed-images/seed-data.json（含 MinIO URL 的完整商品数据）
 */
import { Client } from 'minio';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = __dirname;

// MinIO 配置（与 .env 一致）
const minioClient = new Client({
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
});

const BUCKET = 'meimart';
const OSS_ENDPOINT = 'http://localhost:9000';

// 读取 metadata
const metadata = JSON.parse(
  readFileSync(join(SEED_DIR, 'products-metadata.json'), 'utf-8'),
);

/** i18n 助手：英文 + 中文（简单翻译，seed 阶段够用） */
function makeI18n(en, zh) {
  return { en, zh, id: en, pt: en };
}

/** DummyJSON 品类 -> MeiMart 分类映射 */
const CATEGORY_MAP = {
  groceries: { name: makeI18n('Food & Grocery', '食品杂货'), icon: '🛒', sortOrder: 1 },
  beauty: { name: makeI18n('Beauty', '美妆'), icon: '💄', sortOrder: 2 },
  'skin-care': { name: makeI18n('Skin Care', '护肤'), icon: '🧴', sortOrder: 3 },
  fragrances: { name: makeI18n('Fragrances', '香水'), icon: '🌸', sortOrder: 4 },
};

async function ensureBucket() {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, 'us-east-1');
    console.log(`  bucket created: ${BUCKET}`);
  }
  // dev: 设 public-read
  const policy = {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${BUCKET}/*`],
    }],
  };
  await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
  console.log(`  bucket public-read policy set: ${BUCKET}`);
}

async function uploadImage(localPath, minioKey) {
  const buffer = readFileSync(localPath);
  await minioClient.putObject(BUCKET, minioKey, buffer, buffer.length, {
    'Content-Type': 'image/webp',
  });
  return `${OSS_ENDPOINT}/${BUCKET}/${minioKey}`;
}

async function main() {
  console.log('📤 Uploading product images to MinIO...\n');
  await ensureBucket();

  const seedData = [];
  let uploaded = 0;
  let failed = 0;

  for (const product of metadata) {
    const cat = product.category;
    const slug = product.slug;

    // 上传 thumbnail
    const thumbLocal = join(SEED_DIR, product.thumbnail);
    const thumbKey = `products/${cat}/${slug}-thumb.webp`;
    let thumbUrl = '';
    try {
      thumbUrl = await uploadImage(thumbLocal, thumbKey);
      uploaded++;
    } catch (e) {
      console.error(`  ❌ thumb: ${slug} - ${e.message}`);
      failed++;
    }

    // 上传详情图
    const detailUrls = [];
    for (const imgRel of product.images) {
      const imgLocal = join(SEED_DIR, imgRel);
      const imgKey = `products/${cat}/${imgRel.split('/').pop()}`;
      try {
        const url = await uploadImage(imgLocal, imgKey);
        detailUrls.push(url);
        uploaded++;
      } catch (e) {
        console.error(`  ❌ img: ${slug} - ${e.message}`);
        failed++;
      }
    }

    // 价格转分（DB 存分）
    const priceCents = Math.round(product.price * 100);

    seedData.push({
      title: product.title,
      category: cat,
      categoryName: CATEGORY_MAP[cat].name,
      categoryIcon: CATEGORY_MAP[cat].icon,
      categorySortOrder: CATEGORY_MAP[cat].sortOrder,
      description: makeI18n(product.description, product.description), // 英文描述，zh 暂同
      mainImage: thumbUrl,
      images: detailUrls.length > 0 ? detailUrls : [thumbUrl],
      priceMin: priceCents,
      unit: makeI18n('pack', '包'),
      stock: product.stock || 100,
    });

    console.log(`  ✅ ${cat}/${slug}: thumb + ${detailUrls.length} imgs`);
  }

  // 保存 seed-data.json
  const outputPath = join(SEED_DIR, 'seed-data.json');
  writeFileSync(outputPath, JSON.stringify(seedData, null, 2), 'utf-8');

  console.log(`\n✅ Uploaded: ${uploaded} images`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📦 Products: ${seedData.length}`);
  console.log(`📋 Seed data: ${outputPath}`);

  // 打印分类统计
  const catStats = {};
  for (const p of seedData) {
    catStats[p.category] = (catStats[p.category] || 0) + 1;
  }
  console.log('\n分类统计:');
  for (const [cat, count] of Object.entries(catStats)) {
    console.log(`  ${cat}: ${count} products`);
  }
}

main().catch((e) => {
  console.error('❌ Upload failed:', e);
  process.exit(1);
});
