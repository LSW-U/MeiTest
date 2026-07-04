/**
 * Upload Controller — 图片上传 endpoint
 *
 * 端点：
 *   POST /api/v1/admin/uploads/product-image
 *     - multipart/form-data, field name="file"
 *     - 验 size > 0 + magic bytes（防 mime 欺骗）+ mime ∈ {jpg/png/webp} + size ≤ 5MB
 *     - 写 MinIO bucket `meimart/products/main-{ts}-{rand8}.{ext}`
 *     - 返回 { success: true, data: { url, key, size } }
 *
 * 安全：
 *   - @Roles('super_admin', 'warehouse_staff') — 后台权限
 *   - DeviceTypeGuard 自动校验 admin_web deviceType（admin 前缀路由默认）
 *   - 服务端生成 key，不信任客户端文件名
 *   - magic bytes 校验：不依赖客户端 Content-Type，读前 16 字节判断真实文件类型
 *     防 EXE/SVG/HTML 伪装成 jpg 上传引发存储型 XSS / 钓鱼
 *
 * MVP 权衡：
 *   - 用 memoryStorage（file.buffer 全内存），5MB × 50 并发 ≈ 250MB Node heap
 *     MVP 流量低可接受；未来切 diskStorage + 流式上传更稳（见 W8 收尾）
 */
import {
  Controller,
  Post,
  Inject,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomBytes } from 'crypto';
import { StorageService, StorageError } from '../../shared/storage/storage.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MIN_FILE_SIZE = 1; // 1 byte，防空文件

/** MIME → 扩展名映射（仅用于决定 key 后缀） */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Magic bytes 校验：读前 N 字节判断真实文件类型
 * 不依赖客户端 Content-Type（可伪造），防 mime 欺骗攻击
 *
 * 文件头参考：https://en.wikipedia.org/wiki/List_of_file_signatures
 */
function detectImageFormat(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  // JPEG: FF D8 FF（3 字节）
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A（8 字节）
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  // WebP: RIFF....WEBP（12 字节，4-7 是 size 跳过）
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  ) {
    return 'webp';
  }
  return null;
}

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
        // 第一道：mime header 基础校验（防误传）
        // 真正的 mime 校验在 controller 里通过 magic bytes 做（防伪造）
        if (!ALLOWED_MIME[file.mimetype]) {
          cb(
            new BadRequestException(`不支持的图片类型: ${file.mimetype}，仅支持 jpg/png/webp`),
            false,
          );
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
    // #2 空文件校验
    if (!file.buffer || file.buffer.length < MIN_FILE_SIZE) {
      throw new BadRequestException('文件为空');
    }
    // #1 magic bytes 校验（防 mime 欺骗）
    const detected = detectImageFormat(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        `文件内容不是有效的图片（jpg/png/webp），可能 mime 类型被伪造`,
      );
    }
    // magic bytes 与 header 声明的 mime 不一致 → 拒绝
    if (detected !== ALLOWED_MIME[file.mimetype]) {
      throw new BadRequestException(
        `文件内容（${detected}）与声明的 mime（${file.mimetype}）不一致`,
      );
    }
    const ext = detected;
    // #7 用 crypto.randomBytes 替代 Math.random（密码学安全）
    // key 用 timestamp + 8 字节 hex 随机，不绑 productId（前端先上传拿 URL，再提交 product 表单）
    const rand = randomBytes(4).toString('hex');
    const key = `products/main-${Date.now()}-${rand}.${ext}`;
    // #4 try/catch MinIO 故障，转 InternalServerErrorException + 日志
    let result;
    try {
      result = await this.storage.uploadFile({
        key,
        buffer: file.buffer,
        contentType: file.mimetype,
      });
    } catch (err) {
      this.logger.error({
        msg: 'product_image_upload_failed',
        key,
        size: file.buffer.length,
        mime: file.mimetype,
        error: (err as Error).message,
      });
      if (err instanceof StorageError) {
        throw new InternalServerErrorException({
          code: 'E-UPLOAD-001',
          message: `上传失败: ${err.message}`,
        });
      }
      throw new InternalServerErrorException({
        code: 'E-UPLOAD-002',
        message: '上传失败，请稍后重试',
      });
    }
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
