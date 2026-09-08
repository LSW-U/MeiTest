/**
 * Product Import Service（批F 商品批量导入 2026-09-07）
 *
 * 方案依据：方案v2-批E批F-库存导入细化-20260907.md §3.2 + D1-D12（执行权威）
 *
 * 与批E stocks/import 的**刻意差异**（D12）：
 *   - 批E：逐行独立事务，部分成功语义（successCount + failedRows）
 *   - 批F：**全错全不写**——先全量解析+校验（纯内存），任何错误 → 400 E-PRODUCT-IMPORT-001
 *     返回 failedRows[{line,field,reason}]，一个都不写；全部通过 → 单事务批量插入
 *
 * 判重（D1）：行有 skuCode → 按编码判重（dedupeHash 置 NULL）；
 *   无 skuCode → dedupeHash = sha256(normalize(name 主语言) + 归一化 attributes)。
 *   归一化 = trim + lowercase + 空白折叠（主语言优先级 en > zh > tet，D9）
 *
 * 重复策略（D8）：skip（默认，且提示 skippedRows）/ overwrite（只覆盖目标仓库存数量，
 *   商品主数据不动）/ error（该行进 failedRows → 触发全错全不写）
 */
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { Prisma } from '../../prisma/client';
import { db, withTransaction, type Tx } from '../../shared/db';

/** 单次导入数据行上限（D10/R5，对齐 stocks/import MAX_IMPORT_ROWS 先例） */
const MAX_IMPORT_ROWS = 1000;
/** skuCode 最大长度（宽松格式约束，防超长脏数据） */
const MAX_SKU_CODE_LEN = 64;

/** 价格（元）格式：数值、最多两位小数（0.50 等 <$1 合法，P1-1）；>0 由转分后显式判断（拒 0/0.00） */
const PRICE_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

export type ImportMode = 'skip' | 'overwrite' | 'error';

export interface ProductImportRowError {
  /** CSV 行号（含表头，1-based；表头错 = 1） */
  line: number;
  field: string;
  reason: string;
}

export interface ProductImportResult {
  successCount: number;
  failedCount: number;
  failedRows: ProductImportRowError[];
  /** D8 skip 模式被跳过的重复行（F10「重复 SKU，已跳过」可见） */
  skippedRows: Array<{ line: number; key: string }>;
  /** D8 overwrite 模式只覆盖目标仓库存的行 */
  overwrittenRows: Array<{ line: number; key: string }>;
  createdProducts: Array<{ id: string; name: string; skuCode: string | null }>;
  mode: ImportMode;
}

/** 中英文列头别名映射（D9）——key 为归一化形式（lowercase + 去空格/下划线/连字符/括号） */
const HEADER_ALIASES: Record<string, string> = {
  nameen: 'name_en',
  名称en: 'name_en',
  namezh: 'name_zh',
  名称zh: 'name_zh',
  nametet: 'name_tet',
  名称tet: 'name_tet',
  price: 'price',
  价格元: 'price',
  价格: 'price',
  category: 'category',
  分类: 'category',
  stock: 'stock',
  库存: 'stock',
  skucode: 'skuCode',
  sku编码: 'skuCode',
  商品编码: 'skuCode',
  warehousecode: 'warehouseCode',
  仓库编码: 'warehouseCode',
  mainimage: 'mainImage',
  主图: 'mainImage',
  图片: 'mainImage',
  uniten: 'unit_en',
  单位en: 'unit_en',
  unitzh: 'unit_zh',
  单位zh: 'unit_zh',
  unittet: 'unit_tet',
  单位tet: 'unit_tet',
  descen: 'desc_en',
  描述en: 'desc_en',
  desczh: 'desc_zh',
  描述zh: 'desc_zh',
  desctet: 'desc_tet',
  描述tet: 'desc_tet',
};

/** 归一化列头：lowercase + 去空格/下划线/连字符/括号（'名称_en'→'名称en'，'价格(元)'→'价格元'） */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-()（）]/g, '');
}

/** 名称归一化（dedupeHash 输入，D1）：trim + lowercase + 连续空白折叠 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 校验后的行（内存中间态，全部通过才进事务） */
interface ValidatedRow {
  line: number;
  name: Record<string, string>;
  description: Record<string, string>;
  unit: Record<string, string>;
  mainImage: string;
  /** 元→分转换结果 */
  priceCents: number;
  categoryId: string | null;
  stock: number;
  skuCode: string | null;
  dedupeHash: string | null;
  /** 判重匹配键（与 DB skuCode / hash:{dedupeHash} 同构，用于 existingKeys/行间判重） */
  dedupeKey: string;
  /** 判重展示键（skippedRows/overwrittenRows 提示用：skuCode 或主语言名） */
  dedupeDisplay: string;
  warehouseId: string;
  warehouseCode: string;
}

@Injectable()
export class ProductImportService {
  private readonly logger = new Logger(ProductImportService.name);

  /**
   * 商品批量导入主流程：解析 → 全量校验（纯内存）→ 判重 → 单事务写入 → ImportLog
   *
   * @param buffer CSV 内容（UTF-8 含 BOM，csv-parse bom:true 剥离）
   * @param operatorId 操作人（req.user.sub）
   * @param mode 重复策略（D8，默认 skip）
   * @param fileName 原始文件名（ImportLog 记录）
   */
  async importProducts(
    buffer: Buffer,
    operatorId?: string,
    mode: ImportMode = 'skip',
    fileName?: string,
  ): Promise<ProductImportResult> {
    // ===== 1. 解析（csv-parse：BOM 剥离 + 引号内逗号正确处理，F13） =====
    let records: string[][];
    try {
      records = parse(buffer.toString('utf-8'), {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as string[][];
    } catch (e) {
      throw new BadRequestException({
        code: 'E-PRODUCT-IMPORT-001',
        message: `CSV parse error: ${(e as Error).message}`,
      });
    }
    if (records.length === 0) {
      throw new BadRequestException({
        code: 'E-PRODUCT-IMPORT-001',
        message: 'CSV is empty',
      });
    }
    const dataRows = records.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        code: 'E-PRODUCT-IMPORT-001',
        message: `CSV exceeds max rows (max ${MAX_IMPORT_ROWS} data rows, got ${dataRows.length})`,
      });
    }

    // ===== 2. 列头别名映射（D9） =====
    const rawHeader = (records[0] ?? []).map((h) => h ?? '');
    const headerMap = new Map<string, number>(); // canonical 列名 → 列索引
    rawHeader.forEach((h, idx) => {
      const canonical = HEADER_ALIASES[normalizeHeader(h)];
      if (canonical && !headerMap.has(canonical)) headerMap.set(canonical, idx);
    });
    const col = (row: string[], name: string): string => {
      const idx = headerMap.get(name);
      return idx === undefined ? '' : (row[idx] ?? '').trim();
    };

    // ===== 3. 预载参照数据（分类/仓库/shop——批量内存匹配，避免逐行查库） =====
    const shop = await db.shop.findFirst();
    if (!shop) {
      throw new BadRequestException({ code: 'E-SHOP-001', message: 'Shop not initialized' });
    }
    const [categories, activeWarehouses] = await Promise.all([
      db.category.findMany({ select: { id: true, name: true } }),
      db.warehouse.findMany({
        where: { shopId: shop.id, status: 'ACTIVE' },
        orderBy: { code: 'asc' },
      }),
    ]);
    // D4 缺省仓 = shop 第一个 ACTIVE 仓（code asc）；无 → 未填 warehouseCode 的行报错
    const defaultWarehouse = activeWarehouses[0];
    const warehouseByCode = new Map(activeWarehouses.map((w) => [w.code, w]));
    // D3 分类名精确匹配：任一语言值全等（父子同名命中多个 → 行报错）
    const categoryIndex = new Map<string, string[]>(); // 语言值 → category ids
    for (const c of categories) {
      const names = (c.name ?? {}) as Record<string, string>;
      for (const v of Object.values(names)) {
        const key = v.trim();
        if (!key) continue;
        const ids = categoryIndex.get(key) ?? [];
        ids.push(c.id);
        categoryIndex.set(key, ids);
      }
    }

    // ===== 4. 全量逐行校验（纯内存，不写库——全错全不写红线） =====
    const failedRows: ProductImportRowError[] = [];
    const validRows: ValidatedRow[] = [];
    // 行间判重：同文件内同键出现第二次 → 报错（防同批双写同商品）
    const seenKeys = new Map<string, number>(); // dedupeKey → 首次出现行号

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] ?? [];
      const line = i + 2; // 含表头 1-based
      const fail = (field: string, reason: string) => failedRows.push({ line, field, reason });

      // D9：name_en/zh/tet 至少一列非空；缺失退化主语言取 en > zh > tet
      const nameParts: Record<string, string> = {};
      for (const [canonical, lang] of [
        ['name_en', 'en'],
        ['name_zh', 'zh'],
        ['name_tet', 'tet'],
      ] as const) {
        const v = col(row, canonical);
        if (v) nameParts[lang] = v;
      }
      if (Object.keys(nameParts).length === 0) {
        fail('name_en/zh/tet', 'at least one name column required (name_en/name_zh/name_tet)');
        continue;
      }
      const primaryLang = ['en', 'zh', 'tet'].find((l) => nameParts[l])!;
      const primaryName = nameParts[primaryLang]!;

      // D7：price 必填，元 >0 两位小数 → ×100 转分
      const priceRaw = col(row, 'price');
      if (!priceRaw) {
        fail('price', 'price is required (in dollars, e.g. 3.50)');
        continue;
      }
      if (!PRICE_RE.test(priceRaw)) {
        fail('price', `invalid price (must be a number, max 2 decimals): ${priceRaw}`);
        continue;
      }
      // P1-1：0/0.00 格式合法但必须 > 0（整数分后判断，避免浮点比较歧义）
      const priceCents = Math.round(parseFloat(priceRaw) * 100);
      if (!(priceCents > 0)) {
        fail('price', `price must be > 0: ${priceRaw}`);
        continue;
      }

      // D3：category 可选；填了必须精确匹配唯一
      const categoryRaw = col(row, 'category');
      let categoryId: string | null = null;
      if (categoryRaw) {
        const ids = categoryIndex.get(categoryRaw);
        if (!ids || ids.length === 0) {
          fail('category', `category not found: ${categoryRaw}`);
          continue;
        }
        if (ids.length > 1) {
          // R6：父子分类同名 → 匹配多个报错，模板引导精确分类名
          fail('category', `category ambiguous (${ids.length} matches): ${categoryRaw}`);
          continue;
        }
        categoryId = ids[0]!;
      }

      // F2：stock 可选，默认 0；填了必须 ≥0 整数
      const stockRaw = col(row, 'stock');
      let stock = 0;
      if (stockRaw) {
        stock = Number(stockRaw);
        if (!Number.isInteger(stock) || stock < 0) {
          fail('stock', `stock must be an integer >= 0: ${stockRaw}`);
          continue;
        }
      }

      // skuCode 可选且格式合法（≤64 字符）
      const skuCodeRaw = col(row, 'skuCode');
      if (skuCodeRaw && skuCodeRaw.length > MAX_SKU_CODE_LEN) {
        fail('skuCode', `skuCode too long (max ${MAX_SKU_CODE_LEN}): ${skuCodeRaw.slice(0, 20)}…`);
        continue;
      }

      // 图片 URL 合法或空
      const mainImageRaw = col(row, 'mainImage');
      if (mainImageRaw) {
        try {
          const u = new URL(mainImageRaw);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
        } catch {
          fail('mainImage', `invalid image URL (http/https required): ${mainImageRaw}`);
          continue;
        }
      }

      // D4：warehouseCode 可选且存在；未填用缺省 ACTIVE 仓；无 ACTIVE 仓 → 该行报错
      const warehouseCodeRaw = col(row, 'warehouseCode');
      let warehouse: { id: string; code: string } | undefined;
      if (warehouseCodeRaw) {
        warehouse = warehouseByCode.get(warehouseCodeRaw);
        if (!warehouse) {
          fail('warehouseCode', `warehouse not found (must be ACTIVE, e.g. W01): ${warehouseCodeRaw}`);
          continue;
        }
      } else if (defaultWarehouse) {
        warehouse = { id: defaultWarehouse.id, code: defaultWarehouse.code };
      } else {
        fail('warehouseCode', 'no ACTIVE warehouse in shop (fill warehouseCode or create a warehouse)');
        continue;
      }

      // D1 判重键：有 skuCode → 按编码；无 → name 主语言哈希（attributes CSV 无 → {}）
      const dedupeHash = skuCodeRaw
        ? null
        : createHash('sha256')
            .update(`${normalizeName(primaryName)}::${JSON.stringify({})}`)
            .digest('hex');
      // 匹配键与 DB 侧 existingKeys（skuCode / hash:{dedupeHash}）同构；展示键给人看
      const dedupeKey = skuCodeRaw || `hash:${dedupeHash}`;
      const dedupeDisplay = skuCodeRaw || primaryName;

      const firstSeen = seenKeys.get(dedupeKey);
      if (firstSeen !== undefined) {
        fail(skuCodeRaw ? 'skuCode' : 'name', `duplicate row in file (same key at line ${firstSeen})`);
        continue;
      }
      seenKeys.set(dedupeKey, line);

      const unitParts: Record<string, string> = {};
      for (const [canonical, lang] of [
        ['unit_en', 'en'],
        ['unit_zh', 'zh'],
        ['unit_tet', 'tet'],
      ] as const) {
        const v = col(row, canonical);
        if (v) unitParts[lang] = v;
      }
      const descParts: Record<string, string> = {};
      for (const [canonical, lang] of [
        ['desc_en', 'en'],
        ['desc_zh', 'zh'],
        ['desc_tet', 'tet'],
      ] as const) {
        const v = col(row, canonical);
        if (v) descParts[lang] = v;
      }

      validRows.push({
        line,
        name: nameParts,
        description: descParts,
        unit: unitParts,
        mainImage: mainImageRaw,
        priceCents,
        categoryId,
        stock,
        skuCode: skuCodeRaw || null,
        dedupeHash,
        dedupeKey,
        dedupeDisplay,
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
      });
    }

    // ===== 5. DB 判重（D1×D8）：任何 error 模式命中 → 全错全不写 =====
    if (validRows.length > 0) {
      const skuCodes = validRows.map((r) => r.skuCode).filter((s): s is string => !!s);
      const hashes = validRows.map((r) => r.dedupeHash).filter((h): h is string => !!h);
      const existing = await db.sku.findMany({
        where: {
          OR: [
            ...(skuCodes.length > 0 ? [{ skuCode: { in: skuCodes } }] : []),
            ...(hashes.length > 0 ? [{ dedupeHash: { in: hashes } }] : []),
          ],
        },
        select: { id: true, skuCode: true, dedupeHash: true },
      });
      const existingKeys = new Set<string>();
      for (const s of existing) {
        if (s.skuCode) existingKeys.add(s.skuCode);
        if (s.dedupeHash) existingKeys.add(`hash:${s.dedupeHash}`);
      }

      // D8 三模式分流：skip → skippedRows 提示；overwrite → 只覆盖目标仓库存；error → 进 failedRows
      const skippedRows: Array<{ line: number; key: string }> = [];
      const overwrittenRows: ValidatedRow[] = []; // 保留完整行（事务内要 warehouseId/stock/skuCode）
      const toCreate: ValidatedRow[] = [];
      for (const row of validRows) {
        if (!existingKeys.has(row.dedupeKey)) {
          toCreate.push(row);
        } else if (mode === 'skip') {
          skippedRows.push({ line: row.line, key: row.dedupeDisplay });
        } else if (mode === 'overwrite') {
          overwrittenRows.push(row);
        } else {
          failedRows.push({
            line: row.line,
            field: row.skuCode ? 'skuCode' : 'name',
            reason: `duplicate SKU (mode=error): ${row.dedupeKey}`,
          });
        }
      }

      if (failedRows.length > 0) {
        // 全错全不写（F3/F16 红线）：400 + 全部 failedRows，一个都不写
        throw new BadRequestException({
          code: 'E-PRODUCT-IMPORT-001',
          message: `validation failed (${failedRows.length} rows)`,
          details: { failedRows },
        });
      }

      // ===== 6. 单事务写入（Product + 默认 Sku + Stock + StockLog 初始入库） =====
      const createdProducts = await this.writeAllInTransaction(
        toCreate,
        overwrittenRows,
        operatorId,
        fileName,
        shop.id,
      );

      // ===== 7. ImportLog（D5 v2：后端统一写，含 mode；写失败不阻断） =====
      try {
        await db.importLog.create({
          data: {
            fileName: fileName || 'unknown.csv',
            resourceType: 'Product',
            // P2-4：successCount 只记新建（与响应口径一致），overwrite 行在响应 overwrittenRows 另列
            successCount: createdProducts.length,
            failedCount: 0,
            failedRows: [],
            operatorId,
            mode,
          },
        });
      } catch (e) {
        this.logger.warn(
          `importProducts: write ImportLog failed (import itself succeeded): ${(e as Error).message}`,
        );
      }

      return {
        successCount: createdProducts.length,
        failedCount: 0,
        failedRows: [],
        skippedRows,
        overwrittenRows: overwrittenRows.map((r) => ({ line: r.line, key: r.dedupeDisplay })),
        createdProducts,
        mode,
      };
    }

    // 无有效行（全被前置校验拒绝）
    throw new BadRequestException({
      code: 'E-PRODUCT-IMPORT-001',
      message: `validation failed (${failedRows.length} rows)`,
      details: { failedRows },
    });
  }

  /**
   * 单事务批量写入（全错全不写只在此处开写；F6：批量 create 单事务 500 行 <5s）
   * - 新建行：Product + 默认 Sku（skuCode/dedupeHash 落列）+ Stock（safetyStock 0）+ StockLog INBOUND
   * - overwrite 行：只 upsert 目标仓 Stock quantity（商品主数据不动）+ StockLog ADJUST
   */
  private async writeAllInTransaction(
    toCreate: ValidatedRow[],
    overwrittenRows: ValidatedRow[],
    operatorId: string | undefined,
    fileName: string | undefined,
    shopId: string,
  ): Promise<Array<{ id: string; name: string; skuCode: string | null }>> {
    return withTransaction(
      async (tx: Tx) => {
      const created: Array<{ id: string; name: string; skuCode: string | null }> = [];

      for (const row of toCreate) {
        const product = await tx.product.create({
          data: {
            shopId,
            categoryId: row.categoryId,
            name: row.name,
            description: (Object.keys(row.description).length > 0
              ? row.description
              : Prisma.DbNull) as Prisma.InputJsonValue,
            mainImage: row.mainImage,
            images: [],
            unit: row.unit as Prisma.InputJsonValue,
            status: 'ACTIVE', // D11：默认 ACTIVE 直接上架
            priceMin: row.priceCents, // 单默认 SKU，min 即该价
          },
          select: { id: true },
        });
        const sku = await tx.sku.create({
          data: {
            productId: product.id,
            name: row.name,
            attributes: {} as Prisma.InputJsonValue, // D2：默认 SKU attributes={}
            price: row.priceCents,
            imageUrl: row.mainImage || null,
            skuCode: row.skuCode, // D1：有 skuCode 行 dedupeHash 置 NULL
            dedupeHash: row.dedupeHash,
          },
          select: { id: true },
        });
        await tx.stock.create({
          data: {
            warehouseId: row.warehouseId,
            skuId: sku.id,
            quantity: row.stock,
            safetyStock: 0,
          },
        });
        await tx.stockLog.create({
          data: {
            warehouseId: row.warehouseId,
            skuId: sku.id,
            changeType: 'INBOUND',
            changeQty: row.stock,
            beforeQty: 0,
            afterQty: row.stock,
            reason: row.stock > 0 ? `import: initial stock (${fileName ?? 'csv'})` : `import: product created (${fileName ?? 'csv'})`,
            referenceType: 'IMPORT',
            operatorId,
          },
        });
        created.push({ id: product.id, name: row.name['en'] ?? Object.values(row.name)[0] ?? '', skuCode: row.skuCode });
      }

      // D8 overwrite：只覆盖目标仓库存数量，商品主数据不动
      for (const row of overwrittenRows) {
        const existingSku = await tx.sku.findFirst({
          where: row.skuCode ? { skuCode: row.skuCode } : { dedupeHash: row.dedupeHash! },
          select: { id: true },
        });
        if (!existingSku) continue; // 校验阶段已命中，防御式跳过
        const existingStock = await tx.stock.findUnique({
          where: { warehouseId_skuId: { warehouseId: row.warehouseId, skuId: existingSku.id } },
          select: { quantity: true },
        });
        const beforeQty = existingStock?.quantity ?? 0;
        if (existingStock) {
          await tx.stock.update({
            where: { warehouseId_skuId: { warehouseId: row.warehouseId, skuId: existingSku.id } },
            data: { quantity: row.stock },
          });
        } else {
          await tx.stock.create({
            data: { warehouseId: row.warehouseId, skuId: existingSku.id, quantity: row.stock, safetyStock: 0 },
          });
        }
        await tx.stockLog.create({
          data: {
            warehouseId: row.warehouseId,
            skuId: existingSku.id,
            changeType: 'ADJUST',
            changeQty: row.stock - beforeQty,
            beforeQty,
            afterQty: row.stock,
            reason: `import: overwrite stock (${fileName ?? 'csv'})`,
            referenceType: 'IMPORT',
            operatorId,
          },
        });
      }

      return created;
      },
      // F6：500 行 × 4 表写入可能超默认 10s（实测见单测性能用例），上限放宽到 60s
      { timeoutMs: 60_000 },
    );
  }
}
