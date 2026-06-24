/**
 * Inventory Controllers（W 流程 2026-06-24）
 *
 * - ClientInventoryController  /api/v1/client/inventory/*   地址匹配 + 库存查询
 * - AdminInventoryController   /api/v1/admin/inventory/*    库存管理 + 日志
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Inject,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { z } from 'zod';
import { InventoryService } from './inventory.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

// ============================================================================
// 客户端：库存查询（customer 角色）
// ============================================================================

const MatchWarehouseRequest = z.object({
  lat: z.number(),
  lng: z.number(),
});

@Controller('api/v1/client/inventory')
@Roles('customer')
export class ClientInventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  /** 按收货地址匹配最近仓库 + 配送费 */
  @Post('match-warehouse')
  @HttpCode(HttpStatus.OK)
  async matchWarehouse(@Body(new ZodValidationPipe(MatchWarehouseRequest)) body: { lat: number; lng: number }) {
    const data = await this.inventory.matchWarehouse(body.lat, body.lng);
    return { success: true, data };
  }

  /** 单 SKU 在收货地址所属仓库的库存（切地址刷新） */
  @Get(':skuId')
  async getStockByAddress(
    @Param('skuId') skuId: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    if (!lat || !lng) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: 'lat and lng query params required',
      });
    }
    const data = await this.inventory.getStockByAddress(skuId, Number(lat), Number(lng));
    return { success: true, data };
  }
}

// ============================================================================
// 后台：库存管理（super_admin / warehouse_staff）
// ============================================================================

const AdjustStockRequest = z.object({
  skuId: z.string().uuid(),
  deltaQty: z.number().int().refine((v) => v !== 0, 'DELTA_QTY_NOT_ZERO'),
  reason: z.string().optional(),
});

@Controller('api/v1/admin/inventory')
@Roles('super_admin', 'warehouse_staff')
export class AdminInventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get('stocks')
  async listStocks(
    @Query('warehouseId') warehouseId?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
  ) {
    const data = await this.inventory.listStocks({
      warehouseId,
      lowStockOnly: lowStockOnly === 'true',
    });
    return { success: true, data };
  }

  @Get('logs')
  async listLogs(
    @Query('warehouseId') warehouseId?: string,
    @Query('skuId') skuId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.inventory.listStockLogs({
      warehouseId,
      skuId,
      limit: limit ? Number(limit) : undefined,
    });
    return { success: true, data };
  }

  @Patch('stocks')
  @Audit({ resource: 'Stock' })
  async adjustStock(
    @Body(new ZodValidationPipe(AdjustStockRequest)) body: {
      skuId: string;
      deltaQty: number;
      reason?: string;
    },
    @Query('warehouseId') warehouseId?: string,
    @Request() req?: { user: RequestUser },
  ) {
    if (!warehouseId) {
      throw new BadRequestException({
        code: 'E-COMMON-001',
        message: 'warehouseId query param required',
      });
    }
    const data = await this.inventory.adjustStock({
      warehouseId,
      skuId: body.skuId,
      deltaQty: body.deltaQty,
      reason: body.reason,
      operatorId: req?.user?.sub,
    });
    return { success: true, data };
  }
}
