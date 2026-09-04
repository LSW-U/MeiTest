/**
 * Warehouse Service（W 流程 2026-06-24）
 *
 * 多仓库 CRUD + PostGIS coverageArea 编辑
 *
 * 决策：
 * - 普通字段（name/address/code/lat/lng/...）走 prisma.warehouse
 * - PostGIS 字段（centerPoint/coverageArea）走 setWarehouseGeometry raw SQL
 * - 列表查询不返回 coverageArea GeoJSON（数据量大），单独 endpoint 取
 * - code 唯一（W01-W10），用于 orderNo 16 位生成
 */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import {
  setWarehouseGeometry,
  buildBoxPolygon,
  type GeoJSONPolygon,
} from '../../shared/db/postgis-helpers';
import { decimalToNumber } from '@meimart/shared-utils';

/**
 * 库存聚合行 → warehouseId → StockSummary 映射（批 B，纯函数便于单测）
 *
 * 口径：skuCount=SKU 数；totalQuantity=全部 SKU quantity 之和（含 0）；
 * sellableQuantity=仅 quantity>0 的 quantity 之和。空仓（无行）由调用方补 0/0/0。
 */
export function buildStockSummaryMap(
  rows: Array<{ warehouse_id: string; sku_count: number; total: number; sellable: number }>,
): Map<string, { skuCount: number; totalQuantity: number; sellableQuantity: number }> {
  const map = new Map<string, { skuCount: number; totalQuantity: number; sellableQuantity: number }>();
  for (const r of rows) {
    map.set(r.warehouse_id, {
      skuCount: Number(r.sku_count),
      totalQuantity: Number(r.total),
      sellableQuantity: Number(r.sellable),
    });
  }
  return map;
}

/** WarehouseStaff 关联行 → staffList 项（批 B，纯函数；roles 取 user.role 单值数组） */
export function toStaffList(
  rows: Array<{ id: string; userId: string; user: { name: string | null; role: string } }>,
): Array<{ id: string; userId: string; name: string | null; roles: string[] }> {
  return rows.map((s) => ({
    id: s.id,
    userId: s.userId,
    name: s.user.name,
    roles: [s.user.role],
  }));
}

@Injectable()
export class WarehouseService {
  /** 仓库列表（不含 coverageArea GeoJSON，admin 列表用；批 B 附 stockSummary 库存聚合） */
  async listWarehouses() {
    const items = await db.warehouse.findMany({
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
    // 一次查询聚合全部仓的库存（raw SQL：sellable 用 FILTER 条件求和，Prisma groupBy 做不了）
    const rows = await db.$queryRaw<
      Array<{ warehouse_id: string; sku_count: number; total: number; sellable: number }>
    >`
      SELECT warehouse_id,
             COUNT(*)::int AS sku_count,
             COALESCE(SUM(quantity), 0)::int AS total,
             COALESCE(SUM(quantity) FILTER (WHERE quantity > 0), 0)::int AS sellable
      FROM "stocks"
      GROUP BY warehouse_id
    `;
    const summaryMap = buildStockSummaryMap(rows);
    return items.map((w) => ({
      ...this.toSummaryDTO(w),
      stockSummary: summaryMap.get(w.id) ?? { skuCount: 0, totalQuantity: 0, sellableQuantity: 0 },
    }));
  }

  /** 单个仓库详情（含 coverageArea GeoJSON + staffList，admin 编辑页用） */
  async getWarehouse(id: string) {
    const w = await db.warehouse.findUnique({ where: { id } });
    if (!w) {
      throw new NotFoundException({ code: 'E-WAREHOUSE-003', message: 'Warehouse not found' });
    }
    const coverage = await this.getCoverageGeoJson(id);
    // 在编人员（批 B）：WarehouseStaff → user 姓名 + 角色
    const staffRows = await db.warehouseStaff.findMany({
      where: { warehouseId: id },
      include: { user: { select: { name: true, role: true } } },
    });
    return {
      ...this.toSummaryDTO(w),
      coverageArea: coverage,
      staffList: toStaffList(staffRows),
    };
  }

  /**
   * 创建仓库
   * - 先校验 code 唯一
   * - 先 prisma.warehouse.create（不含 PostGIS 字段）
   * - 再 setWarehouseGeometry 写 center + coverage
   */
  async createWarehouse(input: {
    code: string;
    name: Record<string, string>;
    shopId: string;
    address: string;
    centerLat: number;
    centerLng: number;
    coverageArea?: GeoJSONPolygon | null;
    operatingHours?: unknown;
    deliveryFee?: number;
    perKmFee?: number;
    freeKm?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    // 校验 code 唯一
    const existing = await db.warehouse.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ConflictException({
        code: 'E-WAREHOUSE-001',
        message: `Warehouse code ${input.code} already exists`,
      });
    }

    const created = await db.warehouse.create({
      data: {
        code: input.code,
        name: input.name,
        shopId: input.shopId,
        address: input.address,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        operatingHours: (input.operatingHours ?? null) as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
        deliveryFee: input.deliveryFee ?? 0,
        // 缺省与 schema 默认一致（perKmFee 0=距离计费未启用；freeKm 2km 起步免费距离）
        perKmFee: input.perKmFee ?? 0,
        freeKm: input.freeKm ?? 2,
        status: input.status ?? 'ACTIVE',
      },
    });

    // 写 PostGIS 字段
    const coverage = input.coverageArea ?? buildBoxPolygon(input.centerLng, input.centerLat, 0.05);
    await setWarehouseGeometry(
      db,
      created.id,
      { lon: input.centerLng, lat: input.centerLat },
      coverage,
    );

    return this.toSummaryDTO(created);
  }

  /** 更新仓库（普通字段 + 可选 PostGIS 字段） */
  async updateWarehouse(
    id: string,
    input: Partial<{
      name: Record<string, string>;
      address: string;
      centerLat: number;
      centerLng: number;
      coverageArea: GeoJSONPolygon | null;
      operatingHours: unknown;
      deliveryFee: number;
      perKmFee: number;
      freeKm: number;
      status: 'ACTIVE' | 'INACTIVE';
    }>,
  ) {
    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-WAREHOUSE-003', message: 'Warehouse not found' });
    }

    const updated = await db.warehouse.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.centerLat !== undefined && { centerLat: input.centerLat }),
        ...(input.centerLng !== undefined && { centerLng: input.centerLng }),
        ...(input.operatingHours !== undefined && { operatingHours: input.operatingHours as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue }),
        ...(input.deliveryFee !== undefined && { deliveryFee: input.deliveryFee }),
        ...(input.perKmFee !== undefined && { perKmFee: input.perKmFee }),
        ...(input.freeKm !== undefined && { freeKm: input.freeKm }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });

    // 若传入 PostGIS 字段，更新 center/coverage
    if (input.centerLat !== undefined || input.centerLng !== undefined || input.coverageArea !== undefined) {
      const lon = input.centerLng ?? decimalToNumber(updated.centerLng);
      const lat = input.centerLat ?? decimalToNumber(updated.centerLat);
      const coverage =
        input.coverageArea === null
          ? null
          : input.coverageArea ?? buildBoxPolygon(lon, lat, 0.05);
      if (coverage) {
        await setWarehouseGeometry(db, id, { lon, lat }, coverage);
      }
    }

    return this.toSummaryDTO(updated);
  }

  /** 单独更新 coverage（地图编辑器调） */
  async updateCoverage(id: string, coverage: GeoJSONPolygon) {
    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-WAREHOUSE-003', message: 'Warehouse not found' });
    }
    await setWarehouseGeometry(
      db,
      id,
      { lon: decimalToNumber(existing.centerLng), lat: decimalToNumber(existing.centerLat) },
      coverage,
    );
    return { id, coverageArea: coverage };
  }

  async deleteWarehouse(id: string) {
    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-WAREHOUSE-003', message: 'Warehouse not found' });
    }
    // 软删除：仓库可能被 Stock / Order 引用，硬删会 FK cascade 或丢历史订单
    await db.warehouse.update({ where: { id }, data: { status: 'INACTIVE' } });
  }

  /** 用 raw SQL 取 coverageArea GeoJSON（prisma Unsupported 字段不能直接 select） */
  private async getCoverageGeoJson(id: string): Promise<GeoJSONPolygon | null> {
    const rows = await db.$queryRaw<Array<{ geojson: string | null }>>`
      SELECT ST_AsGeoJSON("coverageArea") AS geojson
      FROM "warehouses"
      WHERE id = ${id}
    `;
    if (rows.length === 0 || !rows[0].geojson) return null;
    return JSON.parse(rows[0].geojson) as GeoJSONPolygon;
  }

  private toSummaryDTO(w: {
    id: string;
    code: string;
    name: unknown;
    shopId: string;
    address: string;
    centerLat: { toNumber(): number };
    centerLng: { toNumber(): number };
    operatingHours: unknown;
    deliveryFee: number;
    perKmFee: number;
    freeKm: { toNumber(): number };
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: w.id,
      code: w.code,
      name: w.name as Record<string, string>,
      shopId: w.shopId,
      address: w.address,
      centerLat: decimalToNumber(w.centerLat),
      centerLng: decimalToNumber(w.centerLng),
      operatingHours: w.operatingHours,
      deliveryFee: w.deliveryFee,
      // 批 B 透出：perKmFee 分/km（int）、freeKm km（Decimal → number）
      perKmFee: w.perKmFee,
      freeKm: decimalToNumber(w.freeKm),
      status: w.status as 'ACTIVE' | 'INACTIVE',
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }
}
