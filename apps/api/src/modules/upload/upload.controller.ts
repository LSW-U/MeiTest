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
 *   - @Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF') — 后台权限
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
import { imageSize } from 'image-size';
import { StorageService, StorageError } from '../../shared/storage/storage.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import {
  MAX_FILE_SIZE,
  MIN_FILE_SIZE,
  ALLOWED_MIME,
  detectImageFormat,
} from './upload.helpers';

/** 图片尺寸约束（防客户端卡片变形 + 防超大图拖慢渲染）— admin 商品图端点专用 */
const MIN_DIMENSION = 200; // 最小 200x200，低于此说明图被强行压缩过，质量差
const MAX_DIMENSION = 2000; // 最大 2000x2000，超过此值客户端渲染慢 + 浪费带宽
const RECOMMENDED_DIMENSION = 600; // 推荐 600x600（1:1 正方形）
const ASPECT_RATIO_TOLERANCE = 0.05; // 1:1 容差 5%（防 599x600 等微差）

/** banner 图尺寸约束（U8，upload 模块批A 2026-09-09）— admin banner-image 端点专用 */
const BANNER_MIN_WIDTH = 600; // 宽下限（低于此轮播图发虚）
const BANNER_MAX_WIDTH = 2000; // 宽上限（超过此渲染慢 + 浪费带宽）
const BANNER_MIN_RATIO = 1.5; // 宽高比下限 1.5:1（区间带下界）
const BANNER_MAX_RATIO = 3.0; // 宽高比上限 3:1（区间带上界；client BannerCarousel 实际显示 ≈2:1，区间给运营裁切余地）

@Controller('api/v1/admin/uploads')
@Roles('SUPER_ADMIN', 'WAREHOUSE_STAFF')
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
        // 错误码化（批A P3-1旧 批C 清账 2026-09-10）：E-UPLOAD-010 对齐
        // upload-client.controller fileFilterRejectMime 样板，移除硬编码中文
        if (!ALLOWED_MIME[file.mimetype]) {
          cb(
            new BadRequestException({
              code: 'E-UPLOAD-010',
              message: `Unsupported image type: ${file.mimetype}, only jpg/png/webp allowed`,
              details: { mime: file.mimetype },
            }),
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
    // #图片尺寸校验（W7-fix：防客户端卡片变形）
    // 1:1 正方形（容差 5%），200-2000 像素，推荐 600x600
    let dims: { width: number; height: number };
    try {
      const r = imageSize(file.buffer);
      if (!r.width || !r.height) {
        throw new BadRequestException('无法读取图片尺寸（文件可能损坏）');
      }
      dims = { width: r.width, height: r.height };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`读取图片尺寸失败: ${(err as Error).message}`);
    }
    if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
      throw new BadRequestException(
        `图片尺寸 ${dims.width}x${dims.height} 过小，最小 ${MIN_DIMENSION}x${MIN_DIMENSION}（推荐 ${RECOMMENDED_DIMENSION}x${RECOMMENDED_DIMENSION}）`,
      );
    }
    if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
      throw new BadRequestException(
        `图片尺寸 ${dims.width}x${dims.height} 过大，最大 ${MAX_DIMENSION}x${MAX_DIMENSION}（推荐 ${RECOMMENDED_DIMENSION}x${RECOMMENDED_DIMENSION}）`,
      );
    }
    // 1:1 比例校验（容差 5%，防 599x600 微差）
    const ratio = dims.width / dims.height;
    if (Math.abs(ratio - 1) > ASPECT_RATIO_TOLERANCE) {
      throw new BadRequestException(
        `图片比例 ${dims.width}:${dims.height} 不是 1:1 正方形，会导致客户端商品卡片变形（请用 ${RECOMMENDED_DIMENSION}x${RECOMMENDED_DIMENSION} 正方形图）`,
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

  @Post('banner-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        // 错误码化（批A P3-1旧 批C 清账 2026-09-10）：E-UPLOAD-010 对齐样板，移除硬编码中文
        if (!ALLOWED_MIME[file.mimetype]) {
          cb(
            new BadRequestException({
              code: 'E-UPLOAD-010',
              message: `Unsupported image type: ${file.mimetype}, only jpg/png/webp allowed`,
              details: { mime: file.mimetype },
            }),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadBannerImage(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ success: true; data: { url: string; key: string; size: number } }> {
    if (!file) {
      throw new BadRequestException('未收到文件（field name 必须为 "file"）');
    }
    // #2 空文件校验
    if (!file.buffer || file.buffer.length < MIN_FILE_SIZE) {
      throw new BadRequestException('文件为空');
    }
    // #1 magic bytes 校验（防 mime 欺骗）+ 与 header 一致性
    const detected = detectImageFormat(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        `文件内容不是有效的图片（jpg/png/webp），可能 mime 类型被伪造`,
      );
    }
    if (detected !== ALLOWED_MIME[file.mimetype]) {
      throw new BadRequestException(
        `文件内容（${detected}）与声明的 mime（${file.mimetype}）不一致`,
      );
    }
    // 尺寸校验（U8 区间带模式：宽 600-2000px + 宽高比 1.5:1-3:1，非 1:1 路径）
    let dims: { width: number; height: number };
    try {
      const r = imageSize(file.buffer);
      if (!r.width || !r.height) {
        throw new BadRequestException('无法读取图片尺寸（文件可能损坏）');
      }
      dims = { width: r.width, height: r.height };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`读取图片尺寸失败: ${(err as Error).message}`);
    }
    if (dims.width < BANNER_MIN_WIDTH) {
      throw new BadRequestException({
        code: 'E-UPLOAD-021',
        message: `图片宽度 ${dims.width} 过小，banner 最小宽度 ${BANNER_MIN_WIDTH}px`,
        details: { width: dims.width, min: BANNER_MIN_WIDTH },
      });
    }
    if (dims.width > BANNER_MAX_WIDTH) {
      throw new BadRequestException({
        code: 'E-UPLOAD-021',
        message: `图片宽度 ${dims.width} 过大，banner 最大宽度 ${BANNER_MAX_WIDTH}px`,
        details: { width: dims.width, max: BANNER_MAX_WIDTH },
      });
    }
    // 宽高比区间带校验（U8：1.5:1 - 3:1，覆盖 client BannerCarousel 实际显示 ≈2:1）
    const ratio = dims.width / dims.height;
    if (ratio < BANNER_MIN_RATIO || ratio > BANNER_MAX_RATIO) {
      throw new BadRequestException({
        code: 'E-UPLOAD-022',
        message: `图片比例 ${dims.width}:${dims.height} 不在 ${BANNER_MIN_RATIO}:1 - ${BANNER_MAX_RATIO}:1 区间内，会导致客户端轮播变形`,
        details: { width: dims.width, height: dims.height, minRatio: BANNER_MIN_RATIO, maxRatio: BANNER_MAX_RATIO },
      });
    }
    const ext = detected;
    const rand = randomBytes(4).toString('hex');
    const key = `banners/banner-${Date.now()}-${rand}.${ext}`;
    let result;
    try {
      result = await this.storage.uploadFile({
        key,
        buffer: file.buffer,
        contentType: file.mimetype,
      });
    } catch (err) {
      this.logger.error({
        msg: 'banner_image_upload_failed',
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
      msg: 'banner_image_uploaded',
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
