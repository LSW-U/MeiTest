/**
 * Pricing Service（W 流程 2026-06-24）
 *
 * 配送费 + 起送价
 *
 * MVP 简化：
 *   - 基础配送费 = warehouse.deliveryFee（已有字段）
 *   - 每公里加价 = 默认 0（不分段，后期 M 流程扩 warehouse schema 加 per_km_fee 字段）
 *   - 起送价 = 默认 0（不起送，后期加 min_order_amount 字段）
 *   - 距离 = PostGIS ST_Distance（球面距离，单位度；转 km 用 111km/度近似）
 *
 * 后期升级（M 流程 platform 模块）：把 perKmFee/minOrderAmount 抽到 system_config 表，admin 可配
 *
 * 内部算法：
 *   - calcDeliveryFee(warehouseId, lat, lng) → {fee, distance, currency}
 *   - checkMinOrder(warehouseId, cartTotal) → {ok, minOrderAmount, shortfall}
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';

/** 默认每公里加价（分/km），MVP 0，后期可由 system_config 覆盖 */
const DEFAULT_PER_KM_FEE = 0;

/** 默认起送价（分），MVP 0，后期可由 system_config 覆盖 */
const DEFAULT_MIN_ORDER_AMOUNT = 0;

/** 度 → 公里换算（赤道 1° ≈ 111km，足够 MVP 精度） */
const KM_PER_DEGREE = 111;

export interface DeliveryFeeResult {
  warehouseId: string;
  baseFee: number;
  perKmFee: number;
  distance: number;
  deliveryFee: number;
  currency: 'USD';
}

export interface MinOrderCheckResult {
  ok: boolean;
  minOrderAmount: number;
  cartTotal: number;
  shortfall: number;
  /** 未达标时的错误码（E-PRICING-001），ok=true 时为 null */
  code: 'E-PRICING-001' | null;
}

@Injectable()
export class PricingService {
  /** 计算配送费（基础费 + 距离加价） */
  async calcDeliveryFee(warehouseId: string, lat: number, lng: number): Promise<DeliveryFeeResult> {
    const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }

    const distance = this.haversineDistance(
      warehouse.centerLat.toNumber(),
      warehouse.centerLng.toNumber(),
      lat,
      lng,
    );

    const baseFee = warehouse.deliveryFee;
    const perKmFee = DEFAULT_PER_KM_FEE;
    const distanceFee = Math.round(distance * perKmFee);
    const deliveryFee = baseFee + distanceFee;

    return {
      warehouseId,
      baseFee,
      perKmFee,
      distance,
      deliveryFee,
      currency: 'USD',
    };
  }

  /** 起送价校验 */
  async checkMinOrder(warehouseId: string, cartTotal: number): Promise<MinOrderCheckResult> {
    const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }
    const minOrderAmount = DEFAULT_MIN_ORDER_AMOUNT;
    const ok = cartTotal >= minOrderAmount;
    return {
      ok,
      minOrderAmount,
      cartTotal,
      shortfall: ok ? 0 : minOrderAmount - cartTotal,
      code: ok ? null : 'E-PRICING-001',
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
      perKmFee: DEFAULT_PER_KM_FEE,
      minOrderAmount: DEFAULT_MIN_ORDER_AMOUNT,
      center: { lat: w.centerLat.toNumber(), lng: w.centerLng.toNumber() },
      status: w.status,
    }));
  }

  /** 更新某仓库的基础配送费（直接 patch warehouse.deliveryFee） */
  async updateBaseFee(warehouseId: string, baseFee: number) {
    const existing = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-COMMON-003', message: 'Warehouse not found' });
    }
    const updated = await db.warehouse.update({
      where: { id: warehouseId },
      data: { deliveryFee: baseFee },
    });
    return {
      warehouseId: updated.id,
      baseFee: updated.deliveryFee,
    };
  }

  /** Haversine 球面距离（度→km 近似） */
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    return Math.sqrt(dLat * dLat + dLng * dLng) * KM_PER_DEGREE;
  }
}
