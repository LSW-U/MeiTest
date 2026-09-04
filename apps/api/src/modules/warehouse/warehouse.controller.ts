/**
 * Warehouse Controller（W 流程 2026-06-24）
 *
 * 全部 /api/v1/admin/warehouses 前缀（super_admin / warehouse_staff）
 *
 * endpoints：
 *   - GET    /              列表
 *   - GET    /:id           详情（含 coverageArea GeoJSON）
 *   - POST   /              创建（写 PostGIS）
 *   - PATCH  /:id           更新（普通字段 + 可选 PostGIS）
 *   - PATCH  /:id/coverage  单独改 coverage 多边形
 *   - DELETE /:id           删除
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UpsertWarehouseRequest, UpdateWarehouseRequest } from '@meimart/api-contract';
import { WarehouseService } from './warehouse.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import { db } from '../../shared/db';

@Controller('api/v1/admin/warehouses')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class WarehouseController {
  constructor(@Inject(WarehouseService) private readonly warehouses: WarehouseService) {}

  @Get()
  async list() {
    const data = await this.warehouses.listWarehouses();
    return { success: true, data };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const data = await this.warehouses.getWarehouse(id);
    return { success: true, data };
  }

  // 请求校验失败（含 operatingHours 结构/语义）→ E-WAREHOUSE-004（errors.json 五语言）
  // create 用全必填 UpsertWarehouseRequest；update 用全可选 UpdateWarehouseRequest（批 B 审查 P2-1，
  // 用户拍板选 a：PATCH 部分更新只动传入字段，admin-web 启停开关/基础信息保存不再 400）
  // static 公开：单测直测 pipe 校验行为（tests/warehouse.service.test.ts）
  static readonly UPSERT_PIPE = new ZodValidationPipe(UpsertWarehouseRequest, 'E-WAREHOUSE-004');
  static readonly UPDATE_PIPE = new ZodValidationPipe(UpdateWarehouseRequest, 'E-WAREHOUSE-004');

  @Post()
  @Audit({ resource: 'Warehouse' })
  async create(@Body(WarehouseController.UPSERT_PIPE) body: {
    code: string;
    name: Record<string, string>;
    coverageArea: { type: 'Polygon'; coordinates: number[][][] } | null;
    centerLat: number;
    centerLng: number;
    address: string;
    operatingHours: unknown;
    deliveryFee: number;
    perKmFee?: number;
    freeKm?: number;
    isActive: boolean;
  }) {
    // shopId 取 db.shop.findFirst（单一商家）
    const shop = await db.shop.findFirst();
    if (!shop) {
      throw new Error('Shop not initialized');
    }
    const data = await this.warehouses.createWarehouse({
      code: body.code,
      name: body.name,
      shopId: shop.id,
      address: body.address,
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      coverageArea: body.coverageArea,
      operatingHours: body.operatingHours,
      deliveryFee: body.deliveryFee,
      perKmFee: body.perKmFee,
      freeKm: body.freeKm,
      status: body.isActive ? 'ACTIVE' : 'INACTIVE',
    });
    return { success: true, data };
  }

  @Patch(':id')
  @Audit({ resource: 'Warehouse' })
  async update(
    @Param('id') id: string,
    @Body(WarehouseController.UPDATE_PIPE) body: Partial<{
      name: Record<string, string>;
      coverageArea: { type: 'Polygon'; coordinates: number[][][] } | null;
      centerLat: number;
      centerLng: number;
      address: string;
      operatingHours: unknown;
      deliveryFee: number;
      perKmFee: number;
      freeKm: number;
      isActive: boolean;
    }>,
  ) {
    const data = await this.warehouses.updateWarehouse(id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.coverageArea !== undefined && { coverageArea: body.coverageArea }),
      ...(body.centerLat !== undefined && { centerLat: body.centerLat }),
      ...(body.centerLng !== undefined && { centerLng: body.centerLng }),
      ...(body.address !== undefined && { address: body.address }),
      ...(body.operatingHours !== undefined && { operatingHours: body.operatingHours }),
      ...(body.deliveryFee !== undefined && { deliveryFee: body.deliveryFee }),
      ...(body.perKmFee !== undefined && { perKmFee: body.perKmFee }),
      ...(body.freeKm !== undefined && { freeKm: body.freeKm }),
      ...(body.isActive !== undefined && { status: body.isActive ? 'ACTIVE' : 'INACTIVE' }),
    });
    return { success: true, data };
  }

  @Patch(':id/coverage')
  @Audit({ resource: 'Warehouse' })
  async updateCoverage(
    @Param('id') id: string,
    @Body() body: { coverageArea: { type: 'Polygon'; coordinates: number[][][] } },
  ) {
    const data = await this.warehouses.updateCoverage(id, body.coverageArea);
    return { success: true, data };
  }

  @Delete(':id')
  @Audit({ resource: 'Warehouse' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.warehouses.deleteWarehouse(id);
    return { success: true, data: null };
  }
}
