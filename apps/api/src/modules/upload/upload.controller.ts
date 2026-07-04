/**
 * Upload Controller — 图片上传 endpoint
 *
 * 端点：
 *   POST /api/v1/admin/uploads/product-image
 *     - multipart/form-data, field name="file"
 *     - 验 mime ∈ {image/jpeg, image/png, image/webp} + size ≤ 5MB
 *     - 写 MinIO bucket `meimart/products/{productId}/main-{ts}.{ext}`
 *     - 返回 { success: true, data: { url } }
 *
 * 安全：
 *   - @Roles('super_admin', 'warehouse_staff') — 后台权限
 *   - DeviceTypeGuard 自动校验 admin_web deviceType（admin 前缀路由默认）
 *   - 服务端生成 key，不信任客户端文件名
 */
import {
  Controller,
  Post,
  Inject,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { StorageService } from '../../shared/storage/storage.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Controller('api/v1/admin/uploads')
@Roles('super_admin', 'warehouse_staff')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Post('product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME[file.mimetype]) {
          cb(new BadRequestException(`不支持的图片类型: ${file.mimetype}，仅支持 jpg/png/webp`), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ success: true; data: { url: string; key: string; size: number } }> {
    if (!file) {
      throw new BadRequestException('未收到文件（field name 必须为 "file"）');
    }
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(`不支持的图片类型: ${file.mimetype}`);
    }
    // key 用 timestamp，不绑 productId（前端先上传拿 URL，再提交 product 表单）
    // 切 prod 时改 OSS_ENDPOINT 即可，DB 数据不用迁
    const key = `products/main-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const result = await this.storage.uploadFile({
      key,
      buffer: file.buffer,
      contentType: file.mimetype,
    });
    this.logger.log({
      msg: 'product_image_uploaded',
      key: result.key,
      size: result.size,
      mime: file.mimetype,
    });
    return {
      success: true,
      data: { url: result.url, key: result.key, size: result.size },
    };
  }
}
