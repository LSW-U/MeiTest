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
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  BatchAdjustRequest,
  TransferRequest,
  ListTransfersQuery,
} from '@meimart/api-contract';
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
@Roles('CUSTOMER')
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
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
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

  // ===== 批次 5：批量调整 + 调拨 + CSV 导入导出 =====

  /** 批量调整（全事务，上限 100） */
  @Post('stocks/batch-adjust')
  @Audit({ resource: 'Stock' })
  async batchAdjustStock(
    @Body(new ZodValidationPipe(BatchAdjustRequest)) body: z.infer<typeof BatchAdjustRequest>,
    @Request() req?: { user: RequestUser },
  ) {
    const data = await this.inventory.batchAdjustStock(
      body.items.map((i) => ({
        warehouseId: i.warehouseId,
        skuId: i.skuId,
        deltaQty: i.deltaQty,
        reason: i.reason,
        operatorId: req?.user?.sub,
      })),
    );
    return { success: true as const, data };
  }

  /** 仓库间调拨（双仓原子） */
  @Post('transfer')
  @Audit({ resource: 'Stock' })
  async transferStock(
    @Body(new ZodValidationPipe(TransferRequest)) body: z.infer<typeof TransferRequest>,
    @Request() req?: { user: RequestUser },
  ) {
    const data = await this.inventory.transferStock({
      fromWarehouseId: body.fromWarehouseId,
      toWarehouseId: body.toWarehouseId,
      items: body.items,
      reason: body.reason,
      operatorId: req?.user?.sub,
    });
    return { success: true as const, data };
  }

  /** 调拨记录列表（按 referenceId 聚合 StockLog） */
  @Get('transfers')
  async listTransfers(
    @Query(new ZodValidationPipe(ListTransfersQuery)) query: z.infer<typeof ListTransfersQuery>,
  ) {
    const data = await this.inventory.listTransfers({
      fromWarehouseId: query.fromWarehouseId,
      toWarehouseId: query.toWarehouseId,
      limit: query.limit,
    });
    return { success: true as const, data };
  }

  /** 导出库存快照 CSV（warehouseId,warehouseCode,skuId,quantity,safetyStock,status） */
  @Get('stocks/export')
  async exportStocksCsv(
    @Query('warehouseId') warehouseId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.inventory.exportStocksCsv(warehouseId ? { warehouseId } : {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stocks-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  /** 导入批量调整 CSV（multipart，field name="file"，逐行部分成功） */
  @Post('stocks/import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 上限
      fileFilter: (_req, file, cb) => {
        const isCsv =
          file.mimetype.includes('csv') || file.originalname.toLowerCase().endsWith('.csv');
        if (!isCsv) {
          cb(new BadRequestException('仅支持 CSV 文件'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Stock' })
  async importStocksCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req?: { user: RequestUser },
  ) {
    if (!file) {
      throw new BadRequestException('未收到文件（field name 必须为 "file"）');
    }
    const data = await this.inventory.importStocksCsv(file.buffer, req?.user?.sub);
    return { success: true as const, data };
  }
}
