# MeiMart 商品导入说明书

> **版本**：v1.0
> **最后更新**：2026-07-09
> **适用范围**：商品批量导入（admin-web 表单 / 脚本 / SQL 直插）

---

## 一、问题背景

2026-07-09 用户反馈两个问题：

### 1.1 中英文切换不生效

**现象**：客户端切到中文，商品名仍显示英文。

**根因**：导入脚本把英文描述填到了 `name` 字段的 4 个语言字段（en/zh/id/pt 值完全相同）。

**DB 实测**（2026-07-09）：

```sql
SELECT name->'en' as en, name->'zh' as zh FROM products LIMIT 3;
```

```
en: "Fresh and crisp apples, perfect for snacking..."
zh: "Fresh and crisp apples, perfect for snacking..."  ← 应该是"苹果"
```

**正确格式**：

```json
{
  "en": "Apple",
  "zh": "苹果",
  "id": "Apel",
  "pt": "Maçã"
}
```

### 1.2 图片导致客户端卡片变形

**现象**：客户端首页 Buy Again 商品卡片图片变形。

**根因**：
- 当前 DB 里 40 个商品图都是 300x300 webp（尺寸一致，本身不变形）
- 但 upload controller 没做图片尺寸/比例校验，未来上传非 1:1 图会变形
- 客户端 CSS 没用 `object-fit: cover` / `aspect-ratio` 兜底

**已修**（W7-fix 2026-07-09）：upload controller 加图片尺寸校验：
- 最小 200x200
- 最大 2000x2000
- 推荐 600x600
- 1:1 正方形（容差 5%）
- 非 1:1 直接拒绝（错误信息提示"会导致客户端商品卡片变形"）

---

## 二、商品字段规范

### 2.1 必填字段

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `id` | UUID | 自动生成（prisma `@default(uuid())`） | `cd7d5207-...` |
| `shopId` | UUID | 必填，预置 1 条平台自营 shop | 查 `shops` 表 |
| `name` | JSON | **4 语言必填**，简短商品名（不是描述！） | `{"en":"Apple","zh":"苹果","id":"Apel","pt":"Maçã"}` |
| `mainImage` | String | 公开访问 URL，1:1 正方形图 | `http://localhost:9000/meimart/products/...` |
| `unit` | JSON | **4 语言必填**，销售单位 | `{"en":"pack","zh":"包","id":"pak","pt":"pacote"}` |
| `priceMin` | Int | 最低价（分），由 SKU 聚合更新，导入时设 0 即可 | `199`（= $1.99） |
| `status` | Enum | `ACTIVE` / `INACTIVE` / `OUT_OF_STOCK`，默认 `ACTIVE` | `ACTIVE` |

### 2.2 可选字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `categoryId` | UUID | 分类 ID，查 `categories` 表 |
| `description` | JSON | 4 语言详细描述 |
| `images` | String[] | 详情页轮播图（除 mainImage 外的附加图） |
| `salesCount` | Int | 销量（默认 0，导入时可不填） |

### 2.3 字段填写规则

#### 多语言字段（name / description / unit）

**必须**是 JSON 对象，4 个语言 key 必填：

```json
{
  "en": "English value",
  "zh": "中文值",
  "id": "Nilai bahasa Indonesia",
  "pt": "Valor em português"
}
```

**禁止**：
- ❌ 直接传字符串：`"Apple"`（前端按 `name[locale]` 取会拿 undefined）
- ❌ 4 语言填同一个值：`{"en":"Apple","zh":"Apple","id":"Apple","pt":"Apple"}`（切换语言无效果）
- ❌ name 字段塞描述：`{"en":"Fresh and crisp apples..."}`（name 应该是简短商品名 "Apple"）

**Tetum 语言**：CLAUDE.md 决策保留 key 但值空字符串（fallback en）：
```json
{ "en": "Apple", "zh": "苹果", "id": "Apel", "pt": "Maçã", "tet": "" }
```

#### 图片字段（mainImage / images）

**必须**是完整公开访问 URL：
- dev：`http://localhost:9000/meimart/products/{category}/{name}-{ts}-{rand8}.jpg`
- prod：`https://oss.meimart.com/meimart/products/...`（CDN 域名）

**禁止**：
- ❌ 相对路径：`/products/foo.jpg`（客户端无法解析）
- ❌ picsum.photos 等占位图服务（生产稳定性无保障）
- ❌ 本地文件路径：`./images/foo.jpg`

**图片规格**：
- 格式：jpg / png / webp（**禁止 gif / bmp / tiff**）
- 尺寸：200x200 ~ 2000x2000 像素
- 推荐尺寸：**600x600 正方形**
- 比例：**1:1 正方形**（容差 5%）
- 文件大小：≤ 5 MB
- magic bytes 必须与 mime 一致（防 txt 伪装 image/jpeg）

#### 价格字段（priceMin）

- 单位：**分**（不是美元/元）
- 例：$1.99 = `199`，$10.00 = `1000`
- 由 SKU 聚合自动更新（`MIN(sku.price)`），导入时设 0 或不填，建 SKU 后自动更新

---

## 三、导入方式

### 3.1 方式 A：admin-web 表单（推荐，单条新增）

**路径**：admin-web -> /products/create

**步骤**：
1. 填 4 语言 name（**简短商品名**，不是描述）
2. 上传 mainImage（自动校验尺寸/比例，1:1 正方形）
3. 填 4 语言 description（可选）
4. 填 4 语言 unit
5. 选 category
6. 选 status（默认 ACTIVE）
7. 提交 -> 跳转商品详情页 -> 加 SKU（含 price）

**优点**：自动 i18n 校验 + 图片尺寸校验 + 自动生成 key + Audit 日志。

### 3.2 方式 B：脚本批量上传（推荐，>10 条商品）

**模板**：见 `docs/product-import-template.csv`（下方提供）

**脚本职责**：
1. 读 CSV/JSON
2. 对每条商品：
   - 上传图片到 MinIO（用 mc 或 S3 SDK）
   - 调 `POST /api/v1/admin/uploads/product-image` 拿 URL（**自动校验尺寸**）
   - 调 `POST /api/v1/admin/products` 创建商品（带 mainImage URL）
   - 调 `POST /api/v1/admin/products/:id/skus` 创建 SKU（含 price）

**示例脚本**：见 `docs/product-import-example.ts`（下方提供）

### 3.3 方式 C：Prisma/SQL 直插（不推荐，仅 dev/debug）

**风险**：跳过所有校验，容易踩坑（i18n 字段填错 / 图片 URL 错 / 价格单位错）。

**只用于**：dev 环境造测试数据，**禁止生产用**。

**SQL 示例**：

```sql
-- 1. 创建商品（注意：name 是 JSON，不是字符串）
INSERT INTO products (id, shop_id, name, main_image, unit, price_min, status, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM shops LIMIT 1),  -- 平台自营 shop
  '{"en":"Apple","zh":"苹果","id":"Apel","pt":"Maçã"}'::jsonb,  -- 必须是 JSON
  'http://localhost:9000/meimart/products/groceries/apple-thumb.webp',
  '{"en":"pack","zh":"包","id":"pak","pt":"pacote"}'::jsonb,
  0,  -- price_min 由 SKU 聚合，先设 0
  'ACTIVE',
  NOW(),
  NOW()
);

-- 2. 创建 SKU（注意：price 单位是分）
INSERT INTO skus (id, product_id, name, attributes, price, status, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM products ORDER BY created_at DESC LIMIT 1),
  '{"en":"Apple (Small)","zh":"苹果（小）","id":"Apple (Kecil)","pt":"Apple (Pequeno)"}'::jsonb,
  '[{"name":"size","value":"small","valueId":"size-small"}]'::jsonb,
  199,  -- $1.99
  'ACTIVE',
  NOW(),
  NOW()
);

-- 3. 更新 product.price_min（取该商品所有 ACTIVE SKU 的最低价）
UPDATE products SET price_min = (
  SELECT MIN(price) FROM skus WHERE product_id = products.id AND status = 'ACTIVE'
) WHERE id = (SELECT id FROM products ORDER BY created_at DESC LIMIT 1);

-- 4. 创建库存（每个仓库一条）
INSERT INTO stocks (id, sku_id, warehouse_id, quantity, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  (SELECT id FROM skus ORDER BY created_at DESC LIMIT 1),
  (SELECT id FROM warehouses LIMIT 1),
  100,  -- 100 件库存
  NOW(),
  NOW()
);
```

---

## 四、CSV 导入模板

`docs/product-import-template.csv`：

```csv
name_en,name_zh,name_id,name_pt,description_en,description_zh,description_id,description_pt,unit_en,unit_zh,unit_id,unit_pt,category,main_image_path,sku_name_en,sku_name_zh,sku_attributes,price_cents
Apple,苹果,Apel,Maçã,"Fresh and crisp apples","新鲜的苹果，适合零食或烹饪","Apel segar","Maçã fresca",pack,包,pak,pacote,groceries,./images/apple.webp,"Apple (Small)","苹果（小）",size:small,199
Apple,苹果,Apel,Maçã,"Fresh and crisp apples","新鲜的苹果，适合零食或烹饪","Apel segar","Maçã fresca",pack,包,pak,pacote,groceries,./images/apple.webp,"Apple (Large)","苹果（大）",size:large,358
Beef Steak,牛排,Bistik,Bife,"High-quality beef steak","优质牛排","Bistik berkualitas","Bife de qualidade",pack,包,pak,pacote,groceries,./images/beef-steak.webp,"Beef Steak (Small)","牛排（小）",size:small,1299
```

**字段说明**：
- `name_*`：4 语言商品名（**简短**，不是描述）
- `description_*`：4 语言详细描述（可空）
- `unit_*`：4 语言销售单位
- `category`：分类 slug（groceries/fragrances/skin-care/beauty 等）
- `main_image_path`：本地图片路径（脚本上传到 MinIO 后拿 URL）
- `sku_name_*`：4 语言 SKU 名（含规格后缀）
- `sku_attributes`：SKU 属性，格式 `key:value`，多个用 `;` 分隔
- `price_cents`：价格（分），$1.99 = 199

---

## 五、导入校验脚本

`scripts/validate-import-csv.ts`：

```typescript
/**
 * 商品导入 CSV 校验脚本
 *
 * 用法：
 *   pnpm --filter @meimart/api tsx scripts/validate-import-csv.ts docs/product-import-template.csv
 *
 * 校验：
 *   - 4 语言字段非空（en 必填，zh/id/pt 至少有一个非空）
 *   - name 字段不是描述（长度 < 50 字符）
 *   - price_cents > 0
 *   - main_image_path 文件存在
 *   - 图片尺寸 200x200~2000x2000 + 1:1 比例
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { imageSize } from 'image-size';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: tsx validate-import-csv.ts <csv-path>');
  process.exit(1);
}

const rows = parse(readFileSync(csvPath, 'utf-8'), { columns: true, skip_empty_lines: true });
let errors = 0;
let warnings = 0;

for (const [i, row] of rows.entries()) {
  const line = i + 2; // +1 header, +1 1-based

  // 4 语言 name 非空
  for (const lang of ['en', 'zh', 'id', 'pt']) {
    if (!row[`name_${lang}`]?.trim()) {
      console.error(`L${line}: name_${lang} 为空`);
      errors++;
    }
  }

  // name 不能是描述（长度 < 50）
  for (const lang of ['en', 'zh', 'id', 'pt']) {
    const v = row[`name_${lang}`]?.trim() ?? '';
    if (v.length > 50) {
      console.error(`L${line}: name_${lang} 长度 ${v.length} > 50，疑似描述当名字用`);
      errors++;
    }
  }

  // 4 语言 name 不能完全相同（i18n 切换无效）
  const names = ['en', 'zh', 'id', 'pt'].map((l) => row[`name_${l}`]?.trim());
  if (new Set(names).size === 1) {
    console.error(`L${line}: 4 语言 name 完全相同（${names[0]}），i18n 切换无效`);
    errors++;
  }

  // price_cents > 0
  const price = parseInt(row.price_cents, 10);
  if (!Number.isFinite(price) || price <= 0) {
    console.error(`L${line}: price_cents=${row.price_cents} 无效（必须 > 0，单位：分）`);
    errors++;
  }

  // main_image_path 文件存在
  const imgPath = row.main_image_path?.trim();
  if (!imgPath) {
    console.error(`L${line}: main_image_path 为空`);
    errors++;
  } else if (!existsSync(imgPath)) {
    console.error(`L${line}: main_image_path 文件不存在: ${imgPath}`);
    errors++;
  } else {
    // 图片尺寸校验
    const buf = readFileSync(imgPath);
    const dims = imageSize(buf);
    if (!dims.width || !dims.height) {
      console.error(`L${line}: 无法读取图片尺寸: ${imgPath}`);
      errors++;
    } else {
      if (dims.width < 200 || dims.height < 200) {
        console.error(`L${line}: 图片尺寸 ${dims.width}x${dims.height} 过小（最小 200x200）`);
        errors++;
      }
      if (dims.width > 2000 || dims.height > 2000) {
        console.error(`L${line}: 图片尺寸 ${dims.width}x${dims.height} 过大（最大 2000x2000）`);
        errors++;
      }
      const ratio = dims.width / dims.height;
      if (Math.abs(ratio - 1) > 0.05) {
        console.error(`L${line}: 图片比例 ${dims.width}:${dims.height} 不是 1:1，会导致客户端卡片变形`);
        errors++;
      }
    }
  }
}

console.log(`\n校验完成: ${errors} 错误, ${warnings} 警告`);
process.exit(errors > 0 ? 1 : 0);
```

---

## 六、当前 DB 修复进度（2026-07-09）

### 6.1 bug 来源

`apps/api/prisma/seed-images/seed-data.json`（40 条商品 seed 数据）的 i18n 字段全部填了英文：
- `description.zh/id/pt` 三语言都填了英文原文
- `unit.id/pt` 都填了 `"pack"`（应为 `pak` / `pacote`）
- `name` 字段还塞了完整英文描述（应为简短商品名）

**根因**：seed 脚本从 DummyJSON 拉数据时只填了 en，其他语言字段直接复制了 en 值。

**风险**：如果再跑 `pnpm --filter @meimart/api db:seed`，bug 会重新出现。修 seed-data.json 之前不要 reseed。

### 6.2 已应用的修复（方案 B：SQL 提取简短英文名）

已跑 `scripts/fix-product-names.sql`（2026-07-09）：

1. 备份：`products_name_backup_20260709`（id + name + description，40 行）
2. 从 `main_image` URL 文件名提取简短英文名：
   - `apple-thumb.webp` → `"Apple"`
   - `calvin-klein-ck-one-eau-de-thumb.webp` → `"Calvin Klein Ck One"`
3. 写回 `name` 字段（仅 `en` key，`zh/id/pt` 暂空）

**回滚**：
```sql
UPDATE products p SET name = b.name
FROM products_name_backup_20260709 b
WHERE p.id = b.id;
```

### 6.3 剩余工作：zh/id/pt 翻译

修复后 `name` JSON 只有 `en` key。前端 fallback 链（`name[locale] ?? name.en ?? ''`）保证切到中文/印尼/葡萄牙时仍显示英文名，不报错但也不翻译。

**待办**：40 条商品的 `name` + `description` + `unit` 都需补 zh/id/pt 翻译。两种路径：
- **路径 A（推荐）**：在 `seed-data.json` 里补翻译后重新 `db:seed`（注意会清表重写，先备份当前 DB 改动）
- **路径 B**：直接写 SQL 逐条 update（保留当前 DB，不动 seed）：
  ```sql
  UPDATE products SET name = jsonb_set(name, '{zh}', '"苹果"'::jsonb)
  WHERE name->>'en' = 'Apple';
  ```

### 6.4 长期方案

修 `apps/api/prisma/seed-images/upload-to-minio.mjs`（生成 seed-data.json 的脚本）：
- 从 DummyJSON 拉数据时，对每个 i18n 字段调翻译 API 或人工填值
- 或换有完整多语言数据的 seed 源

---

## 七、常见错误对照

| 错误 | 原因 | 修法 |
|---|---|---|
| 客户端切语言商品名不变 | name 4 语言填了相同值 | 4 语言独立填值 |
| 客户端商品名显示 undefined | name 是字符串而非 JSON | 改为 `{"en":"...","zh":"..."}` |
| 客户端商品名显示很长描述 | name 字段塞了 description | name 应是简短商品名（< 50 字符） |
| 商品卡片图片变形 | 图片比例非 1:1 | 用 600x600 正方形图（已加服务端校验） |
| 上传图片报"图片尺寸过小" | 图片 < 200x200 | 用 600x600 推荐 |
| 上传图片报"图片尺寸过大" | 图片 > 2000x2000 | 压缩到 600x600 |
| 上传图片报"图片比例不是 1:1" | 比如 800x600 | 裁剪为 600x600 正方形 |
| 上传图片报"文件内容与 mime 不一致" | 改了文件扩展名但内容没改 | 用对应工具重新导出 |
| 商品显示价格 $0 | price_min 未聚合 | 创建 SKU 后跑 `UPDATE products SET price_min = (SELECT MIN(price) FROM skus WHERE product_id = products.id AND status = 'ACTIVE')` |
| 商品下单报"无库存" | 没创建 stock 记录 | `INSERT INTO stocks ...` |

---

## 八、参考

- **数据库 schema**：`apps/api/prisma/schema.prisma` §Product / §Sku / §Stock
- **多语言字段决策**：CLAUDE.md §多语言字段
- **upload 端点**：`POST /api/v1/admin/uploads/product-image`（W7-feature）
- **图片校验规则**：`apps/api/src/modules/upload/upload.controller.ts`（W7-fix 加尺寸校验）
- **i18n 切换实现**：admin-web 用 next-intl，客户端用 i18next（按 Accept-Language header）
- **W7 验收报告**：`docs/W7-final-acceptance-report.md`

---

**报告版本**：v1.0
**最后更新**：2026-07-09
