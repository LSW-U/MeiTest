/**
 * ImportLog 模块 schema（批E D5 v2 2026-09-07：导入历史跨批通用接口）
 *
 * 决策依据：方案v2-批E批F-库存导入细化-20260907.md D5
 * - 后端统一写（stocks/import 与 products/import 的 service 成功路径各写一条，前端只查不补记）
 * - 只留 GET /api/v1/admin/import-logs 查询；v1 的 POST /import-logs（前端补记）已删除
 * - AuditLog（安全审计视角）与 ImportLog（业务运营历史：文件名/成功率/明细）并存
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

export const ImportLogResourceType = z.enum(['Product', 'Stock']);

export const ImportLogItem = z.object({
  id: Id,
  fileName: z.string(),
  resourceType: ImportLogResourceType,
  successCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  /** 失败明细 [{row, error}]，与导入响应 failedRows 同构 */
  failedRows: z.array(z.object({ row: z.number().int(), error: z.string() })),
  operatorId: Id.nullable(),
  /** 重复策略（批F 商品导入 skip|overwrite|error；库存导入为空） */
  mode: z.string().nullable(),
  createdAt: IsoTimestamp,
});

export const ListImportLogsQuery = z.object({
  resourceType: ImportLogResourceType.optional(),
  operatorId: Id.optional(),
  /** 时间范围（ISO 8601，含 from 不含 to） */
  from: IsoTimestamp.optional(),
  to: IsoTimestamp.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const ImportLogListResponse = z.object({
  items: z.array(ImportLogItem),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
});

// ============================================================================
// 批F 商品批量导入（POST /api/v1/admin/products/import，multipart）
// 方案 D8/D12：全错全不写（有错 400 返 failedRows[{line,field,reason}]，一个都不写）；
// 重复策略三模式（默认 skip 且提示 skippedRows）；成功响应 failedRows 恒空
// ============================================================================

export const ImportMode = z.enum(['skip', 'overwrite', 'error']);

export const ProductImportRowError = z.object({
  /** CSV 行号（含表头，1-based） */
  line: z.number().int(),
  field: z.string(),
  reason: z.string(),
});

export const ProductImportResult = z.object({
  successCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  failedRows: z.array(ProductImportRowError),
  /** D8 skip 模式被跳过的重复行（F10「重复 SKU，已跳过」可见） */
  skippedRows: z.array(z.object({ line: z.number().int(), key: z.string() })),
  /** D8 overwrite 模式只覆盖目标仓库存的行 */
  overwrittenRows: z.array(z.object({ line: z.number().int(), key: z.string() })),
  createdProducts: z.array(
    z.object({
      id: Id,
      name: z.string(),
      skuCode: z.string().nullable(),
    }),
  ),
  mode: ImportMode,
});
