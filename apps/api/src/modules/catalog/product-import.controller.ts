/**
 * Admin Product Import Controller（批F 商品批量导入 2026-09-07）
 *
 * POST /api/v1/admin/products/import
 *   - multipart file（memoryStorage 只读流不落盘，2MB 上限 + CSV 过滤器，F7/F19）
 *   - ?mode=skip|overwrite|error（D8 重复策略，默认 skip）
 *   - 行数 ≤1000（service 层，对齐 stocks/import 先例）
 *   - @Audit({ resource: 'Product' })（F19）
 *   - @Roles('SUPER_ADMIN','WAREHOUSE_STAFF')（F1，库存导入主力 WAREHOUSE_STAFF）
 *
 * 全错全不写（D12 红线）：校验/判重错误 → 400 E-PRODUCT-IMPORT-001 + details.failedRows
 * 错误码分配（E12：后端只返错误码+英文兜底消息，前端 i18n 展示）：
 *   001 校验/判重失败（service） 002 非 CSV 文件 003 未收到文件 004 mode 非法（P3-1）
 */
import {
  Controller,
  Post,
  Query,
  Inject,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProductImportService, type ImportMode } from './product-import.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

const IMPORT_MODES = new Set<ImportMode>(['skip', 'overwrite', 'error']);

@Controller('api/v1/admin/products')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
export class AdminProductImportController {
  constructor(
    @Inject(ProductImportService) private readonly productImport: ProductImportService,
  ) {}

  /** 批量导入商品 CSV（multipart field="file"；?mode=skip|overwrite|error） */
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB（D10，F7）
      fileFilter: (_req, file, cb) => {
        const isCsv =
          file.mimetype.includes('csv') || file.originalname.toLowerCase().endsWith('.csv');
        if (!isCsv) {
          cb(new BadRequestException({ code: 'E-PRODUCT-IMPORT-002', message: 'only CSV files are supported' }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Product' })
  async importProducts(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('mode') mode?: string,
    @Request() req?: { user: RequestUser },
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'E-PRODUCT-IMPORT-003',
        message: 'no file received (multipart field name must be "file")',
      });
    }
    // P3-1：mode 非法值直接 400，不静默回退 skip（用户以为在 error 模式的运营风险）
    let importMode: ImportMode = 'skip';
    if (mode !== undefined && mode !== '') {
      if (!IMPORT_MODES.has(mode as ImportMode)) {
        throw new BadRequestException({
          code: 'E-PRODUCT-IMPORT-004',
          message: `invalid mode (must be skip/overwrite/error): ${mode}`,
        });
      }
      importMode = mode as ImportMode;
    }
    const data = await this.productImport.importProducts(
      file.buffer,
      req?.user?.sub,
      importMode,
      file.originalname,
    );
    return { success: true as const, data };
  }
}
