/**
 * Product Import Service 测试（批F 2026-09-07，对照验收 F18 八类）
 *
 * 八类覆盖（编号 #1-#8 对应任务书）：
 *   #1 解析：BOM 剥离 + 中英文列头别名 + 引号内逗号（csv-parse）
 *   #2 校验：50 行含 5 错 → 400 全明细 + **0 写入**（全错全不写红线）；name/price/分类/stock/URL/仓库逐字段
 *   #3 判重：skuCode/dedupeHash 双键 × skip/overwrite/error 三模式 + 行间重复
 *   #4 事务回滚：事务内写失败异常上抛不吞（原子性由 prisma 单事务保证，mock 验证异常路径）
 *   #5 幂等：同文件二次导入 → 第二次全 skip，不产生重复数据
 *   #6 权限：@Roles('SUPER_ADMIN','WAREHOUSE_STAFF') + @Audit(Product) 元数据断言（RolesGuard 全局，先例 auth.controller.test）
 *   #7 文件限制：空 CSV / >1000 行 → 400（2MB 由 multer limits 配置，代码审查项）
 *   #8 性能：500 行全流程（mock 层验证单事务编排 + 计时参考；真实 DB 计时挂账 F6 联调）
 *   #9 controller：mode 参数校验非法值 400（P3-1，修复轮新增）
 *
 * 价格单位（F5/D7 头号坑）：'3.5' → 350 分专项断言
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  shopFindFirst: vi.fn(),
  categoryFindMany: vi.fn(),
  warehouseFindMany: vi.fn(),
  skuFindMany: vi.fn(),
  importLogCreate: vi.fn(),
  txProductCreate: vi.fn(),
  txSkuCreate: vi.fn(),
  txSkuFindFirst: vi.fn(),
  txStockCreate: vi.fn(),
  txStockFindUnique: vi.fn(),
  txStockUpdate: vi.fn(),
  txStockLogCreate: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    shop: { findFirst: m.shopFindFirst },
    category: { findMany: m.categoryFindMany },
    warehouse: { findMany: m.warehouseFindMany },
    sku: { findMany: m.skuFindMany },
    importLog: { create: m.importLogCreate },
  },
  withTransaction: m.withTransaction,
}));

import { ProductImportService } from '../src/modules/catalog/product-import.service';
import { ROLES_KEY } from '../src/shared/decorators/roles.decorator';
import { AUDIT_KEY } from '../src/shared/decorators/audit.decorator';
import { AdminProductImportController } from '../src/modules/catalog/product-import.controller';

const SHOP_ID = 'shop-uuid-1';
const WH_ID = 'wh-uuid-1';

const DEFAULT_HEADER = 'name_en,name_zh,price,category,stock,skuCode,warehouseCode,mainImage';

/** 默认把 withTransaction mock 成直接执行 fn 传 mock tx（简化，fn 抛错即 reject） */
function mockTxPassthrough() {
  m.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      product: { create: m.txProductCreate },
      sku: { create: m.txSkuCreate, findFirst: m.txSkuFindFirst },
      stock: { create: m.txStockCreate, findUnique: m.txStockFindUnique, update: m.txStockUpdate },
      stockLog: { create: m.txStockLogCreate },
    }),
  );
}

function setupDefaults() {
  m.shopFindFirst.mockResolvedValue({ id: SHOP_ID });
  m.categoryFindMany.mockResolvedValue([
    { id: 'cat-drink', name: { zh: '饮料', en: 'Beverage' } },
    { id: 'cat-milk', name: { zh: '乳制品', en: 'Dairy' } },
  ]);
  m.warehouseFindMany.mockResolvedValue([{ id: WH_ID, code: 'W01' }]);
  m.skuFindMany.mockResolvedValue([]);
  m.importLogCreate.mockResolvedValue({});
  m.txProductCreate.mockImplementation(() => {
    return Promise.resolve({ id: `prod-${m.txProductCreate.mock.calls.length}` });
  });
  m.txSkuCreate.mockResolvedValue({ id: 'sku-new' });
  m.txStockCreate.mockResolvedValue({});
  m.txStockLogCreate.mockResolvedValue({});
  mockTxPassthrough();
}

describe('ProductImportService（批F）', () => {
  let service: ProductImportService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new ProductImportService();
    setupDefaults();
  });

  // ===== #1 解析 =====
  describe('#1 解析（BOM/中文列名/引号内逗号）', () => {
    it('BOM 前缀 + 中文列头别名（名称_zh/价格(元)/分类/库存）→ 正常导入', async () => {
      const bom = '﻿';
      const csv = `${bom}名称_zh,名称_en,价格(元),分类,库存\n测试商品A,Product A,3.5,饮料,10`;
      const result = await service.importProducts(Buffer.from(csv, 'utf-8'), 'op-1', 'skip', 't.csv');

      expect(result.successCount).toBe(1);
      // D7 元→分：3.5 元 = 350 分
      expect(m.txSkuCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ price: 350 }) }),
      );
      // 分类名称精确匹配 → categoryId 落库
      expect(m.txProductCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ categoryId: 'cat-drink', priceMin: 350 }),
        }),
      );
    });

    it('引号内逗号正确解析（csv-parse vs 后端手写 split 的差异）', async () => {
      // 引号内逗号落在 desc_en 列（8 列头下含逗号值需引号包裹，csv-parse 正确处理）
      const csv = `name_en,desc_en,price,category,stock\nProductB,"Desc, with comma",2.00,乳制品,5`;
      const result = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv');
      expect(result.successCount).toBe(1);
      expect(m.txProductCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: { en: 'ProductB' },
            description: { en: 'Desc, with comma' },
            categoryId: 'cat-milk',
          }),
        }),
      );
    });

    it('2.00 元 → 200 分（两位小数转换，F5 价格单位专项）', async () => {
      const csv = `${DEFAULT_HEADER}\nP-EN,商品C,2.00,饮料,0`;
      await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv');
      expect(m.txSkuCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ price: 200 }) }),
      );
    });
  });

  // ===== #2 校验（全错全不写） =====
  describe('#2 校验（F3/F16：50 行含 5 错 → 400 + 0 写入）', () => {
    it('50 行含 5 错 → 400 E-PRODUCT-IMPORT-001，failedRows 5 条含 {line,field,reason}，一个都不写', async () => {
      const rows: string[] = [];
      // 5 个错误行（交错在合法行中）：name 全空 / price 0 / price 三位小数 / category 不存在 / stock 负数
      rows.push(',,,,,,'); // line 2: name 全空
      for (let i = 1; i <= 11; i++) rows.push(`Good${i},商品${i},1.50,饮料,3`); // 11 合法
      rows.push('Bad2,错误2,0,饮料,3'); // price = 0
      for (let i = 13; i <= 25; i++) rows.push(`Good${i},商品${i},1.50,饮料,3`);
      rows.push('Bad3,错误3,1.999,饮料,3'); // price 三位小数
      rows.push('Bad4,错误4,1.50,不存在的分类,3'); // category 不存在
      for (let i = 28; i <= 51; i++) rows.push(`Good${i},商品${i},1.50,饮料,3`);
      rows.push('Bad5,错误5,1.50,饮料,-1'); // stock 负数
      const csv = `${DEFAULT_HEADER}\n${rows.join('\n')}`;

      const err = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 'big.csv').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = err.getResponse();
      expect(resp.code).toBe('E-PRODUCT-IMPORT-001');
      const failedRows = resp.details.failedRows;
      expect(failedRows).toHaveLength(5);
      expect(failedRows.map((f: { line: number }) => f.line)).toEqual([2, 14, 28, 29, 54]);
      expect(failedRows[1]).toMatchObject({ field: 'price' });
      // 红线：一个都不写
      expect(m.txProductCreate).not.toHaveBeenCalled();
      expect(m.importLogCreate).not.toHaveBeenCalled();
    });

    it('name_en/zh/tet 全空 → 该行报错（D9 必填不满足）', async () => {
      const csv = `${DEFAULT_HEADER}\n,,,饮料,3`;
      const err = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv').catch((e) => e);
      expect(err.getResponse().details.failedRows[0]).toMatchObject({
        field: 'name_en/zh/tet',
        line: 2,
      });
    });

    it('price 0/负数/非数字 → 报错；mainImage 非 http(s) URL → 报错', async () => {
      // 8 列对齐（skuCode/warehouseCode 留空），URL 落 mainImage 列而非 skuCode 列
      const csv = `${DEFAULT_HEADER}\nA,甲,1.00,饮料,0,,,https://x.com/a.png\nB,乙,abc,饮料,0\nC,丙,1.00,饮料,0,,,ftp://bad`;
      const err = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv').catch((e) => e);
      const rows = err.getResponse().details.failedRows;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ line: 3, field: 'price' });
      expect(rows[1]).toMatchObject({ line: 4, field: 'mainImage' });
    });

    it('price <$1 合法：0.50→50 分、0.05→5 分；0.00 → 报错（P1-1：正则放行小数 + 显式 >0）', async () => {
      const csv = `${DEFAULT_HEADER}\nA,甲,0.50,饮料,1\nB,乙,0.05,饮料,1`;
      const result = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv');
      expect(result.successCount).toBe(2);
      expect(m.txSkuCreate.mock.calls[0][0].data.price).toBe(50);
      expect(m.txSkuCreate.mock.calls[1][0].data.price).toBe(5);

      // 0.00 格式合法但必须 > 0（全错全不写 → 400）
      const csv2 = `${DEFAULT_HEADER}\nC,丙,0.00,饮料,1`;
      const err = await service.importProducts(Buffer.from(csv2), 'op-1', 'skip', 't.csv').catch((e) => e);
      expect(err.getResponse().details.failedRows[0]).toMatchObject({ line: 2, field: 'price' });
    });

    it('category 匹配多个（父子同名）→ 报错（D3/R6）', async () => {
      m.categoryFindMany.mockResolvedValue([
        { id: 'cat-a', name: { zh: '乳制品' } },
        { id: 'cat-b', name: { zh: '乳制品' } },
      ]);
      const csv = `${DEFAULT_HEADER}\nA,甲,1.00,乳制品,3`;
      const err = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv').catch((e) => e);
      expect(err.getResponse().details.failedRows[0]).toMatchObject({
        field: 'category',
        reason: expect.stringContaining('ambiguous (2 matches)'),
      });
    });

    it('warehouseCode 不存在 → 报错；无 ACTIVE 仓且未填 → 该行报错（D4）', async () => {
      const csv = `${DEFAULT_HEADER}\nA,甲,1.00,饮料,3,,W99`;
      const err = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv').catch((e) => e);
      expect(err.getResponse().details.failedRows[0]).toMatchObject({ field: 'warehouseCode' });

      m.warehouseFindMany.mockResolvedValue([]); // 无 ACTIVE 仓
      const csv2 = `${DEFAULT_HEADER}\nA,甲,1.00,饮料,3`;
      const err2 = await service.importProducts(Buffer.from(csv2), 'op-1', 'skip', 't.csv').catch((e) => e);
      expect(err2.getResponse().details.failedRows[0].reason).toContain('no ACTIVE warehouse');
    });
  });

  // ===== #3 判重（D1×D8） =====
  describe('#3 判重三模式', () => {
    // skuCode 落第 6 列（name_en 留空用 name_zh），name 必填仍满足
    const dupCsv = `${DEFAULT_HEADER}\n,重复商品,1.00,饮料,9,EXIST-CODE`;

    it('mode=skip（默认）→ 跳过且提示 skippedRows，不写入', async () => {
      m.skuFindMany.mockResolvedValue([{ id: 'sku-exist', skuCode: 'EXIST-CODE', dedupeHash: null }]);
      const result = await service.importProducts(Buffer.from(dupCsv), 'op-1', 'skip', 't.csv');

      expect(result.mode).toBe('skip');
      expect(result.skippedRows).toEqual([{ line: 2, key: 'EXIST-CODE' }]);
      expect(result.successCount).toBe(0);
      expect(m.txProductCreate).not.toHaveBeenCalled(); // 商品主数据不动
      expect(m.txStockUpdate).not.toHaveBeenCalled();
      // ImportLog 记成功路径（部分跳过也记）
      expect(m.importLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ resourceType: 'Product', mode: 'skip' }) }),
      );
    });

    it('mode=overwrite → 只覆盖目标仓 stock（商品/SKU 不新建），StockLog ADJUST 记录差值', async () => {
      m.skuFindMany.mockResolvedValue([{ id: 'sku-exist', skuCode: 'EXIST-CODE', dedupeHash: null }]);
      m.txSkuFindFirst.mockResolvedValue({ id: 'sku-exist' });
      m.txStockFindUnique.mockResolvedValue({ quantity: 5 });
      m.txStockUpdate.mockResolvedValue({});

      const result = await service.importProducts(Buffer.from(dupCsv), 'op-1', 'overwrite', 't.csv');

      expect(result.overwrittenRows).toEqual([{ line: 2, key: 'EXIST-CODE' }]);
      expect(result.successCount).toBe(0); // createdProducts 不含覆盖行
      expect(m.txProductCreate).not.toHaveBeenCalled();
      expect(m.txStockUpdate).toHaveBeenCalledWith({
        where: { warehouseId_skuId: { warehouseId: WH_ID, skuId: 'sku-exist' } },
        data: { quantity: 9 },
      });
      // ADJUST：before 5 → after 9，changeQty 4
      expect(m.txStockLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changeType: 'ADJUST', changeQty: 4, beforeQty: 5, afterQty: 9 }),
        }),
      );
      // P2-4：ImportLog successCount 只记新建（=0），与响应口径一致（overwrite 不计入）
      expect(m.importLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ successCount: 0, mode: 'overwrite' }) }),
      );
    });

    it('mode=error → 重复行进 failedRows → 400 全错全不写', async () => {
      m.skuFindMany.mockResolvedValue([{ id: 'sku-exist', skuCode: 'EXIST-CODE', dedupeHash: null }]);
      const err = await service.importProducts(Buffer.from(dupCsv), 'op-1', 'error', 't.csv').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().details.failedRows[0]).toMatchObject({
        line: 2,
        field: 'skuCode',
        reason: expect.stringContaining('duplicate SKU (mode=error)'),
      });
      expect(m.txProductCreate).not.toHaveBeenCalled();
    });

    it('无 skuCode → dedupeHash（sha256 归一化 name 主语言）判重命中', async () => {
      // 同名两次导入：第二次 DB 已有同 hash
      m.skuFindMany.mockImplementation((_args: unknown) => Promise.resolve([]));
      const csv = `${DEFAULT_HEADER}\nMilk,牛奶,1.00,饮料,2`;
      await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't1.csv');

      // 第二次：捕获第一次事务里写入的 dedupeHash，模拟 DB 已存在
      const savedHash = m.txSkuCreate.mock.calls[0][0].data.dedupeHash;
      expect(savedHash).toBeTruthy();
      m.skuFindMany.mockResolvedValue([{ id: 'sku-old', skuCode: null, dedupeHash: savedHash }]);
      m.txProductCreate.mockClear();
      m.txSkuCreate.mockClear();

      const result = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't2.csv');
      // 展示键 = 主语言名（无 skuCode 行）；匹配靠 dedupeHash 列命中（successCount 0 即证明）
      expect(result.skippedRows[0]).toMatchObject({ line: 2, key: 'Milk' });
      expect(result.successCount).toBe(0);
      expect(m.txProductCreate).not.toHaveBeenCalled();
    });
  });

  // ===== #4 事务回滚 =====
  describe('#4 事务回滚（异常上抛不吞）', () => {
    it('事务内 product.create 抛错 → withTransaction reject（prisma 单事务原子回滚）', async () => {
      m.withTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          product: { create: vi.fn().mockRejectedValue(new Error('P2002 unique violation')) },
          sku: { create: m.txSkuCreate, findFirst: m.txSkuFindFirst },
          stock: { create: m.txStockCreate, findUnique: m.txStockFindUnique, update: m.txStockUpdate },
          stockLog: { create: m.txStockLogCreate },
        }),
      );
      const csv = `${DEFAULT_HEADER}\nA,甲,1.00,饮料,3`;
      await expect(
        service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv'),
      ).rejects.toThrow('P2002 unique violation');
    });
  });

  // ===== #5 幂等 =====
  describe('#5 幂等（同文件二次导入不产生脏数据）', () => {
    it('第一次建 2 个，第二次同文件 → 全 skip、0 新建、DB 只有一份', async () => {
      const csv = `${DEFAULT_HEADER}\nA,甲,1.00,饮料,2\nB,乙,2.00,乳制品,3`;

      // 第一次导入：空库
      const r1 = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv');
      expect(r1.successCount).toBe(2);

      // 第二次导入：DB 已有第一次的两行（按 skuCode/hash 查回）
      const saved = m.txSkuCreate.mock.results.map(
        (_r, i) => m.txSkuCreate.mock.calls[i][0].data,
      );
      m.skuFindMany.mockResolvedValue(
        saved.map((d: { skuCode: string | null; dedupeHash: string | null }, i: number) => ({
          id: `sku-${i}`,
          skuCode: d.skuCode,
          dedupeHash: d.dedupeHash,
        })),
      );
      m.txProductCreate.mockClear();
      m.txSkuCreate.mockClear();

      const r2 = await service.importProducts(Buffer.from(csv), 'op-1', 'skip', 't.csv');
      expect(r2.successCount).toBe(0);
      expect(r2.skippedRows).toHaveLength(2);
      expect(m.txProductCreate).not.toHaveBeenCalled();
    });
  });

  // ===== #6 权限（装饰器元数据，RolesGuard 全局消费） =====
  describe('#6 权限（F1）', () => {
    it('POST /products/import 声明 SUPER_ADMIN + WAREHOUSE_STAFF（非 @Public）', () => {
      // @Roles 挂在 controller 类上（RolesGuard getAllAndOverride [handler, class]）
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        AdminProductImportController,
      ) as string[] | undefined;
      expect(roles).toEqual(['SUPER_ADMIN', 'WAREHOUSE_STAFF']);
      // audit resource = Product（F19）
      const audit = Reflect.getMetadata(
        AUDIT_KEY,
        AdminProductImportController.prototype.importProducts,
      ) as { resource?: string } | undefined;
      expect(audit?.resource).toBe('Product');
    });
  });

  // ===== #7 文件限制 =====
  describe('#7 文件限制（F7，2MB 由 multer limits 配置）', () => {
    it('空 CSV → 400 E-PRODUCT-IMPORT-001', async () => {
      await expect(
        service.importProducts(Buffer.from(''), 'op-1', 'skip', 'empty.csv'),
      ).rejects.toMatchObject({ response: { code: 'E-PRODUCT-IMPORT-001' } });
    });

    it('1001 数据行 → 400（MAX_IMPORT_ROWS，D10/R5）', async () => {
      const lines = [DEFAULT_HEADER];
      for (let i = 0; i < 1001; i++) lines.push(`P${i},商品${i},1.00,饮料,1`);
      await expect(
        service.importProducts(Buffer.from(lines.join('\n')), 'op-1', 'skip', 'big.csv'),
      ).rejects.toMatchObject({ response: { code: 'E-PRODUCT-IMPORT-001' } });
    });
  });

  // ===== #8 性能 =====
  describe('#8 性能（F6）', () => {
    it('500 行合法 CSV 全流程完成 + 单事务编排（真实 DB 计时挂账 F6 联调）', async () => {
      const lines = [DEFAULT_HEADER];
      for (let i = 0; i < 500; i++) lines.push(`Perf${i},性能${i},1.50,饮料,1,PERF-${i}`);
      const buffer = Buffer.from(lines.join('\n'));

      const t0 = Date.now();
      const result = await service.importProducts(buffer, 'op-1', 'skip', 'perf.csv');
      const elapsed = Date.now() - t0;

      expect(result.successCount).toBe(500);
      expect(m.withTransaction).toHaveBeenCalledTimes(1); // 单事务（不是逐行 N 事务）
      expect(m.txProductCreate).toHaveBeenCalledTimes(500);
      expect(m.importLogCreate).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line no-console
      console.log(`[perf] 500 rows (mock tx): ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ===== #9 controller：mode 参数校验（P3-1：非法值 400，不静默回退 skip） =====
  describe('#9 controller（P3-1 mode 校验）', () => {
    const mockFile = { originalname: 't.csv', buffer: Buffer.from('x') } as Express.Multer.File;

    it('mode=skipp（typo）→ 400 E-PRODUCT-IMPORT-004，不进 service', async () => {
      const svc = { importProducts: vi.fn().mockResolvedValue({}) };
      const controller = new AdminProductImportController(svc as never);
      await expect(
        controller.importProducts(mockFile, 'skipp', undefined),
      ).rejects.toMatchObject({ response: { code: 'E-PRODUCT-IMPORT-004' } });
      expect(svc.importProducts).not.toHaveBeenCalled();
    });

    it('mode 缺省 → 默认 skip；mode=overwrite → 透传 service', async () => {
      const svc = { importProducts: vi.fn().mockResolvedValue({}) };
      const controller = new AdminProductImportController(svc as never);
      await controller.importProducts(mockFile, undefined, undefined);
      expect(svc.importProducts).toHaveBeenCalledWith(mockFile.buffer, undefined, 'skip', 't.csv');
      await controller.importProducts(mockFile, 'overwrite', { user: { sub: 'op-1' } } as never);
      expect(svc.importProducts).toHaveBeenLastCalledWith(mockFile.buffer, 'op-1', 'overwrite', 't.csv');
    });
  });
});
