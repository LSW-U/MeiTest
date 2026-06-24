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
import {
  setWarehouseGeometry,
  buildBoxPolygon,
  type GeoJSONPolygon,
} from '../../shared/db/postgis-helpers';

@Injectable()
export class WarehouseService {
  /** 仓库列表（不含 coverageArea GeoJSON，admin 列表用） */
  async listWarehouses() {
    const items = await db.warehouse.findMany({
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
    return items.map((w) => this.toSummaryDTO(w));
  }

  /** 单个仓库详情（含 coverageArea GeoJSON，admin 编辑页用） */
  async getWarehouse(id: string) {
    const w = await db.warehouse.findUnique({ where: { id } });
    if (!w) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }
    const coverage = await this.getCoverageGeoJson(id);
    return {
      ...this.toSummaryDTO(w),
      coverageArea: coverage,
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
        operatingHours: input.operatingHours ?? null,
        deliveryFee: input.deliveryFee ?? 0,
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
      status: 'ACTIVE' | 'INACTIVE';
    }>,
  ) {
    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }

    const updated = await db.warehouse.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.centerLat !== undefined && { centerLat: input.centerLat }),
        ...(input.centerLng !== undefined && { centerLng: input.centerLng }),
        ...(input.operatingHours !== undefined && { operatingHours: input.operatingHours }),
        ...(input.deliveryFee !== undefined && { deliveryFee: input.deliveryFee }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });

    // 若传入 PostGIS 字段，更新 center/coverage
    if (input.centerLat !== undefined || input.centerLng !== undefined || input.coverageArea !== undefined) {
      const lon = input.centerLng ?? Number(updated.centerLng);
      const lat = input.centerLat ?? Number(updated.centerLat);
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
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }
    await setWarehouseGeometry(
      db,
      id,
      { lon: Number(existing.centerLng), lat: Number(existing.centerLat) },
      coverage,
    );
    return { id, coverageArea: coverage };
  }

  async deleteWarehouse(id: string) {
    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }
    await db.warehouse.delete({ where: { id } });
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
      centerLat: w.centerLat.toNumber(),
      centerLng: w.centerLng.toNumber(),
      operatingHours: w.operatingHours,
      deliveryFee: w.deliveryFee,
      status: w.status as 'ACTIVE' | 'INACTIVE',
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }
}
