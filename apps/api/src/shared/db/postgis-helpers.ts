/**
 * PostGIS 适配层（prisma-raw + helper 函数）
 *
 * 决策依据：
 * - CLAUDE.md §技术栈：PostgreSQL 16 + PostGIS 3.4 用 prisma-raw 适配
 * - schema.prisma 中 centerPoint / coverageArea 用 Unsupported("geometry(..., 4326)")?
 *   Prisma 客户端无法直接读写，必须走 prisma.$queryRaw / $executeRaw
 *
 * 关键函数：
 *   - findWarehouseByPoint: 按经纬度匹配最近仓库（下单时用）
 *   - setWarehouseCenter: 写入 center_point
 *   - setWarehouseCoverage: 写入 coverage_area
 *
 * 单测：必须用 testcontainers 起 postgis/postgis:16-3.4 真实容器（D2-T4 后做）
 *      禁止 mock PostGIS 函数，否则看不出真实查询行为
 */
import { PrismaClient } from '../../prisma/client';

/** GeoJSON Polygon（用于 coverage_area） */
export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/**
 * 按经纬度匹配覆盖该点的最近 ACTIVE 仓库
 *
 * 业务用途：下单时按收货地址自动匹配最近仓库（PostGIS ST_Within）
 * 失败 → 业务层抛 E-ORDER-OUT-OF-DELIVERY-RANGE
 */
export async function findWarehouseByPoint(
  prisma: PrismaClient,
  lon: number,
  lat: number,
): Promise<
  | {
      id: string;
      code: string;
      name: unknown;
      deliveryFee: number;
      distance: number;
    }
  | null
> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      code: string;
      name: unknown;
      delivery_fee: number;
      distance: number;
    }>
  >`
    SELECT
      id,
      code,
      name,
      delivery_fee,
      ST_Distance(
        "centerPoint",
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
      ) AS distance
    FROM "warehouses"
    WHERE status = 'ACTIVE'
      AND "coverageArea" IS NOT NULL
      AND ST_Within(
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326),
        "coverageArea"
      )
    ORDER BY distance ASC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    deliveryFee: r.delivery_fee,
    distance: r.distance,
  };
}

/**
 * PostGIS 球面距离（km）：仓库中心点 → 收货地址点
 *
 * 距离计费批次1（2026-08-27）：P3-1 审查报告修复，从 pricing.service 迁移到 PostGIS 适配层集中。
 * ⚠️ ST_MakePoint(lng, lat) 经度在前！写反距离全错（派单/计费连锁错误）。
 * 复用 warehouses."centerPoint"（Point 4326）。
 *
 * @returns km（球面距离，米 / 1000）；仓库无 centerPoint 时返回 null
 */
export async function distanceSphereKm(
  prisma: PrismaClient,
  warehouseId: string,
  lng: number,
  lat: number,
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ km: number | null }>>`
    SELECT
      ST_DistanceSphere(
        "centerPoint",
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
      ) / 1000.0 AS km
    FROM "warehouses"
    WHERE id = ${warehouseId}
      AND "centerPoint" IS NOT NULL
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const km = rows[0].km;
  return km == null ? null : Number(km);
}

/**
 * 校验收货地址是否在仓库覆盖范围内（ST_Within）
 *
 * 距离计费批次1（2026-08-27）：P3-1 审查报告修复，calcDeliveryFee 深度防御守卫。
 * 防止未来 admin 试算/跨仓对账等调用方绕过 createOrder 的 coverage 预守卫 → 跨区计费。
 *
 * @returns true=在覆盖区内（或 coverageArea 为空时放宽通过，兼容历史数据）
 */
export async function isPointInWarehouseCoverage(
  prisma: PrismaClient,
  warehouseId: string,
  lng: number,
  lat: number,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ within: boolean | null }>>`
    SELECT
      CASE
        WHEN "coverageArea" IS NULL THEN TRUE
        ELSE ST_Within(
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          "coverageArea"
        )
      END AS within
    FROM "warehouses"
    WHERE id = ${warehouseId}
    LIMIT 1
  `;
  if (rows.length === 0) return false;
  return rows[0].within === true;
}

/** UPSERT 仓库中心点（写入 center_point） */
export async function setWarehouseCenter(
  prisma: PrismaClient,
  warehouseId: string,
  lon: number,
  lat: number,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "warehouses"
    SET "centerPoint" = ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    WHERE id = ${warehouseId}
  `;
}

/** UPSERT 仓库覆盖区域（写入 coverage_area） */
export async function setWarehouseCoverage(
  prisma: PrismaClient,
  warehouseId: string,
  geojson: GeoJSONPolygon,
): Promise<void> {
  const geojsonStr = JSON.stringify(geojson);
  await prisma.$executeRaw`
    UPDATE "warehouses"
    SET "coverageArea" = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)
    WHERE id = ${warehouseId}
  `;
}

/** UPSERT 仓库中心点 + 覆盖区域（一次操作，常用于种子/migration） */
export async function setWarehouseGeometry(
  prisma: PrismaClient,
  warehouseId: string,
  center: { lon: number; lat: number },
  coverage: GeoJSONPolygon,
): Promise<void> {
  const geojsonStr = JSON.stringify(coverage);
  await prisma.$executeRaw`
    UPDATE "warehouses"
    SET
      "centerPoint" = ST_SetSRID(ST_MakePoint(${center.lon}, ${center.lat}), 4326),
      "coverageArea" = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)
    WHERE id = ${warehouseId}
  `;
}

/**
 * 构造矩形覆盖区域的 GeoJSON Polygon（简化种子数据生成）
 *
 * @param centerLon 中心经度
 * @param centerLat 中心纬度
 * @param radiusDeg 半径（度数，约 0.01° ≈ 1.1km）
 */
export function buildBoxPolygon(
  centerLon: number,
  centerLat: number,
  radiusDeg: number,
): GeoJSONPolygon {
  const minLon = centerLon - radiusDeg;
  const maxLon = centerLon + radiusDeg;
  const minLat = centerLat - radiusDeg;
  const maxLat = centerLat + radiusDeg;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat], // 闭合
      ],
    ],
  };
}
