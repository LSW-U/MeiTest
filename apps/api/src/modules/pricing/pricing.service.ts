/**
 * Pricing Service（W 流程 2026-06-24；距离计费改造 2026-08-27 批次1）
 *
 * 配送费 + 起送价
 *
 * 配送费距离计费（2026-08-27，《02-配送费计算公式.md》Q1-Q11 定稿）：
 *   deliveryFee = baseFee + max(0, distanceKm - freeKm) × perKmFee
 *   - baseFee = warehouse.deliveryFee（500/600/700 分 = $5/$6/$7，本期保留不动）
 *   - freeKm = warehouse.freeKm（默认 2km，base 覆盖起步距离）
 *   - perKmFee = warehouse.perKmFee（默认 0 = 功能未启用，灰度安全网；配 50 分/km 生效）
 *   - distanceKm = PostGIS ST_DistanceSphere（球面距离，米 → /1000 km）
 *   - Math.round 取整到分
 *   - per_km_fee = 0 时公式退化为 baseFee —— 与改造前现状完全一致
 *
 * 距离算法：PostGIS ST_DistanceSphere（替换原欧氏度近似）
 *   - ⚠️ ST_MakePoint(lng, lat) 经度在前、纬度在后，写反距离全错
 *   - 走 $queryRaw，与 postgis-helpers.ts 同模式
 *   - 复用 warehouses GIST 索引（idx_warehouses_center_gist）
 *
 * 起送价 = 本期不生效（P2-3 审查报告：checkMinOrder 死代码已删，起送价需求激活时再实装）
 *
 * 内部算法：
 *   - calcDeliveryFee(warehouseId, lat, lng) → DeliveryFeeResult
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import { distanceSphereKm, isPointInWarehouseCoverage } from '../../shared/db/postgis-helpers';
import { decimalToNumber } from '@meimart/shared-utils';

/** 默认起步距离（km），warehouse.free_km 为空时兜底 */
const DEFAULT_FREE_KM = 2;

/**
 * 配送费计算结果
 *
 * distanceKm：PostGIS 球面距离（km）；地址无坐标时 calcDeliveryFee 不应被调用
 *   （order.service 已守卫 address.lat/lng 非空），但保留 null 语义防御。
 */
export interface DeliveryFeeResult {
  warehouseId: string;
  baseFee: number;
  perKmFee: number;
  freeKm: number;
  /** 配送距离（km），PostGIS ST_DistanceSphere；null = 无坐标（不应发生在 calcDeliveryFee 路径） */
  distanceKm: number | null;
  /** 距离加价（分）= max(0, distanceKm - freeKm) × perKmFee，Math.round 取整 */
  distanceFee: number;
  /** 配送费总额（分）= baseFee + distanceFee */
  deliveryFee: number;
  currency: 'USD';
}

/** 计价快照（写入 Order.delivery_fee_breakdown，骑手端明细 + 灰度校准数据源） */
export interface DeliveryFeeBreakdown {
  baseFee: number;
  distanceFee: number;
  distanceKm: number | null;
  perKmFee: number;
  freeKm: number;
}

/**
 * PostGIS 球面距离（km）：仓库中心点 → 收货地址点
 *
 * ⚠️ ST_MakePoint(lng, lat) 经度在前！写反距离全错（派单/计费连锁错误）。
 * 复用 warehouses."centerPoint"（Point 4326）+ GIST 索引 idx_warehouses_center_gist。
 *
 * @returns km（球面距离，米 / 1000）；仓库无 centerPoint 时返回 null
 *
 * P3-1 修复（2026-08-27 审查报告）：已迁移到 shared/db/postgis-helpers.ts，本文件不再保留实现。
 */
// distanceSphereKm 实现已迁至 postgis-helpers.ts（P3-1），通过顶部 import 引入

@Injectable()
export class PricingService {
  /**
   * 计算配送费（基础费 + 距离加价）
   *
   * 公式：deliveryFee = Math.round(baseFee + max(0, distanceKm - freeKm) × perKmFee)
   * per_km_fee = 0 时退化为 baseFee（灰度安全网，与改造前现状一致）。
   *
   * @param lat 纬度
   * @param lng 经度
   */
  async calcDeliveryFee(warehouseId: string, lat: number, lng: number): Promise<DeliveryFeeResult> {
    const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }

    const baseFee = warehouse.deliveryFee;
    const perKmFee = warehouse.perKmFee;
    // freeKm 是 Prisma Decimal（@db.Decimal(10,2)），运行时为 Decimal 对象，经 decimalToNumber 归一
    // null 兜底 DEFAULT_FREE_KM（migration NOT NULL DEFAULT 2，理论不空，防御历史脏数据）
    const freeKm = decimalToNumber(warehouse.freeKm, DEFAULT_FREE_KM);

    // PostGIS 球面距离（仓库中心 → 收货地址）；centerPoint 缺失 → null
    const distanceKm = await distanceSphereKm(db, warehouseId, lng, lat);

    // P3-1 修复（2026-08-27 审查报告）：coverage 深度防御守卫
    // 当前唯一调用方 createOrder 在 Step 1 已按 coverageArea 选仓库，但本函数未来会被
    // admin 试算/骑手预估/跨仓对账等调用方直接调，自守卫防跨区计费（A 仓给 B 仓覆盖地址算距离费）。
    // coverageArea 为空（历史数据）时 isPointInWarehouseCoverage 放宽返回 true，不阻断。
    const inCoverage = await isPointInWarehouseCoverage(db, warehouseId, lng, lat);
    if (!inCoverage) {
      throw new NotFoundException({
        code: 'E-COMMON-003',
        message: 'Address out of warehouse coverage',
      });
    }

    // 距离加价：max(0, km - freeKm) × perKmFee
    // distanceKm 为 null（无 centerPoint）时 distanceFee = 0，退化为 baseFee
    const chargeableKm =
      distanceKm == null ? 0 : Math.max(0, distanceKm - freeKm);
    // P1-1 修复（2026-08-27 审查报告）：deliveryFee 整体取整，对齐方案《02-配送费计算公式.md》定稿
    //   deliveryFee = Math.round(baseFee + chargeableKm × perKmFee)
    // distanceFee 单独 Math.round 仅作 breakdown 明细展示，可能与 deliveryFee - baseFee 差 1 分
    //   （浮点 .5 边界）—— 以 deliveryFee 整体取整为权威，distanceFee 仅展示用
    const distanceFee = Math.round(chargeableKm * perKmFee);
    const deliveryFee = Math.round(baseFee + chargeableKm * perKmFee);

    return {
      warehouseId,
      baseFee,
      perKmFee,
      freeKm,
      distanceKm,
      distanceFee,
      deliveryFee,
      currency: 'USD',
    };
  }

  /** 取所有仓库的配送费配置（admin 用） */
  async listWarehousePricingConfig() {
    const warehouses = await db.warehouse.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        deliveryFee: true,
        perKmFee: true,
        freeKm: true,
        centerLat: true,
        centerLng: true,
        status: true,
      },
      orderBy: { code: 'asc' },
    });
    return warehouses.map((w) => ({
      warehouseId: w.id,
      code: w.code,
      name: w.name as Record<string, string>,
      baseFee: w.deliveryFee,
      perKmFee: w.perKmFee,
      freeKm: decimalToNumber(w.freeKm, DEFAULT_FREE_KM),
      minOrderAmount: 0,
      center: { lat: decimalToNumber(w.centerLat), lng: decimalToNumber(w.centerLng) },
      status: w.status,
    }));
  }

  /**
   * 更新某仓库的配送费配置（批次3 灰度配置，2026-08-28）
   *
   * 替代旧 updateBaseFee（仅改 baseFee）——扩展为可一并改 perKmFee/freeKm，
   * 供 admin 灰度配值：per_km_fee=0 上线（行为=现状）→ admin 配 50 分/km 生效。
   *
   * 三字段全可选 partial 更新：未传字段不动（Prisma update 仅写传入键）。
   * baseFee 写 warehouses.deliveryFee；perKmFee 写 warehouses.per_km_fee；
   * freeKm 写 warehouses.free_km（Decimal 列，Prisma 接受 number）。
   *
   * @param baseFee   基础费（分，≥0 整数）—— warehouse.deliveryFee
   * @param perKmFee  每公里加价（分，≥0 整数）—— 0 = 距离费未启用（灰度安全网）
   * @param freeKm    起步免费距离（km，≥0）—— warehouse.freeKm
   */
  async updatePricingConfig(
    warehouseId: string,
    params: { baseFee?: number; perKmFee?: number; freeKm?: number },
  ) {
    const existing = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }

    // 仅写传入字段；Prisma update 跳过 undefined 键，未传字段保持原值
    const data: { deliveryFee?: number; perKmFee?: number; freeKm?: number } = {};
    if (params.baseFee !== undefined) data.deliveryFee = params.baseFee;
    if (params.perKmFee !== undefined) data.perKmFee = params.perKmFee;
    if (params.freeKm !== undefined) data.freeKm = params.freeKm;

    const updated = await db.warehouse.update({
      where: { id: warehouseId },
      data,
    });

    // freeKm 是 Prisma Decimal，运行时经 decimalToNumber 归一为 number 返回给前端
    const freeKm = decimalToNumber(updated.freeKm, DEFAULT_FREE_KM);

    return {
      warehouseId: updated.id,
      baseFee: updated.deliveryFee,
      perKmFee: updated.perKmFee,
      freeKm,
    };
  }

  /**
   * @deprecated 批次3（2026-08-28）：被 updatePricingConfig 取代。
   *   旧端点 PATCH /admin/pricing/warehouses/:warehouseId/base-fee 仅改 baseFee，
   *   已重构为 PATCH /admin/pricing/warehouses/:warehouseId/config（partial 三字段）。
   *   保留方法供内部/迁移期调用，新代码请用 updatePricingConfig。
   */
  async updateBaseFee(warehouseId: string, baseFee: number) {
    return this.updatePricingConfig(warehouseId, { baseFee });
  }
}
