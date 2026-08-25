/**
 * Client Upload Controller — 客户端图片上传 endpoint（P13 售后图片 + P15 B2 评价图 + P22 F2 反馈图）
 *
 * 端点：
 *   POST /api/v1/client/uploads/refund-evidence  (P13 售后凭证)
 *   POST /api/v1/client/uploads/review-image     (P15 B2 评价图)
 *   POST /api/v1/client/uploads/feedback-image    (P22 F2 反馈截图)
 *     - multipart/form-data, field name="file"
 *     - CUSTOMER 权限 + DeviceTypeGuard 自动校验 client_app deviceType
 *     - 验 size > 0 + magic bytes（防 mime 欺骗）+ mime ∈ {jpg/png/webp} + size ≤ 5MB
 *     - 最小尺寸 100×100（防空图/图标滥用），无最大尺寸 + 无 1:1 约束（凭证/评价/反馈图任意比例）
 *     - 写 MinIO：refund-evidence -> `refunds/evidence-{ts}-{rand8}.{ext}`
 *                review-image    -> `reviews/image-{ts}-{rand8}.{ext}`
 *                feedback-image  -> `feedbacks/image-{ts}-{rand8}.{ext}`
 *     - 返回 { success: true, data: { url, key, size } }
 *
 * 重构（P3-2，2026-08-12）：端点校验 + 上传主体逻辑 95% 相同，抽 uploadImage private helper
 * 共用，仅 keyPrefix/logLabel 三参数分化。fileFilter 因 multer 类型耦合
 * 无法干净抽模块级常量，保留各端点内联（FileInterceptor 上下文推断参数类型）。
 *
 * F2 修复（P22 审查，2026-08-25）：所有 BadRequestException 走错误码 E-UPLOAD-010..018
 *   （与 rider-upload.controller 对齐，五语言 locale 已 seed），消除硬编码中文。
 *   sizeErrorLabel 中文移除，改为 details 尺寸数字由前端按 locale 拼接。
 *
 * 与 admin 商品图端点（upload.controller.ts）的差异：
 *   - 权限：CUSTOMER（admin 端点是 SUPER_ADMIN/WAREHOUSE_STAFF）
 *   - 尺寸：最小 100×100，无上限 + 无 1:1（admin 端点 200-2000px + 1:1 正方形）
 *   - 路径：refunds/ + reviews/ + feedbacks/（admin 端点 products/main-*）
 *   - 共用：MAX_FILE_SIZE / MIN_FILE_SIZE / ALLOWED_MIME / detectImageFormat（upload.helpers.ts）
 *
 * 安全：
 *   - 服务端生成 key，不信任客户端文件名
 *   - magic bytes 校验（不依赖客户端 Content-Type，防 EXE/SVG/HTML 伪装）
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

/** 售后凭证/评价图最小尺寸（100×100 防空图/图标滥用，宽于商品图 200） */
const MIN_DIMENSION = 100;

/** 上传成功返回结构 */
interface UploadResult {
  success: true;
  data: { url: string; key: string; size: number };
}

/**
 * multer fileFilter 共用：mime header 基础校验（防误传）。
 * 真正的 mime 校验在 controller 里通过 magic bytes 做（防伪造）。
 * 错误码化（F2）：E-UPLOAD-010 不支持的图片类型。
 */
function fileFilterRejectMime(_req: any, file: Express.Multer.File, cb: any) {
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
}

@Controller('api/v1/client/uploads')
@Roles('CUSTOMER')
export class ClientUploadController {
  private readonly logger = new Logger(ClientUploadController.name);

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** P13 售后凭证上传（2026-08-10） */
  @Post('refund-evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: fileFilterRejectMime,
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadRefundEvidence(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadResult> {
    return this.uploadImage(file, {
      keyPrefix: 'refunds/evidence-',
      logLabel: 'refund_evidence',
    });
  }

  /**
   * P15 B2：评价图片上传（2026-08-11）
   * 与 refund-evidence 完全同模式，仅 MinIO 路径前缀不同（reviews/image-* vs refunds/evidence-*）。
   * 不复用同一端点：业务语义不同（"评价图" vs "售后凭证"）+ 路径前缀分化便于审计/清理。
   */
  @Post('review-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: fileFilterRejectMime,
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadReviewImage(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadResult> {
    return this.uploadImage(file, {
      keyPrefix: 'reviews/image-',
      logLabel: 'review_image',
    });
  }

  /**
   * P22 F2：反馈截图上传（2026-08-19）
   * 与 review-image 完全同模式，仅 MinIO 路径前缀不同（feedbacks/image-*）。
   * 止血用途：此前反馈页复用 review-image，real 模式上传的 URL 无消费方（表单不提交）
   * → MinIO 孤儿文件 + reviews/ 前缀语义污染。此端点把反馈图隔离到 feedbacks/ 前缀，
   * F1 提交端点落地后 URL 随 Feedback.images 落库。
   */
  @Post('feedback-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: fileFilterRejectMime,
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadFeedbackImage(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadResult> {
    return this.uploadImage(file, {
      keyPrefix: 'feedbacks/image-',
      logLabel: 'feedback_image',
    });
  }

  // ===================== 内部 =====================

  /**
   * 图片上传核心逻辑（refund-evidence + review-image 共用，P3-2 重构 2026-08-12 抽出）
   *
   * 校验链路：空文件 → magic bytes → magic vs header 一致性 → 最小尺寸 100×100 → 服务端生成 key → MinIO 上传
   *
   * 错误码化（F2 修复，2026-08-25）：所有 BadRequestException 携带 { code, message, details }，
   * code 取 E-UPLOAD-010..018（与 rider-upload 对齐，五语言 locale 已 seed）。
   *
   * @param options.keyPrefix       MinIO key 前缀（如 'refunds/evidence-' / 'reviews/image-'）
   * @param options.logLabel        日志 msg 前缀（自动拼 _uploaded / _upload_failed）
   */
  private async uploadImage(
    file: Express.Multer.File | undefined,
    options: { keyPrefix: string; logLabel: string },
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException({
        code: 'E-UPLOAD-011',
        message: 'No file received (field name must be "file")',
      });
    }
    // 空文件校验
    if (!file.buffer || file.buffer.length < MIN_FILE_SIZE) {
      throw new BadRequestException({ code: 'E-UPLOAD-012', message: 'File is empty' });
    }
    // magic bytes 校验（防 mime 欺骗，不依赖客户端 Content-Type）
    const detected = detectImageFormat(file.buffer);
    if (!detected) {
      throw new BadRequestException({
        code: 'E-UPLOAD-013',
        message: 'File content is not a valid image (jpg/png/webp), the mime type may be forged',
      });
    }
    // magic bytes 与 header 声明的 mime 不一致 → 拒绝（防伪造）
    if (detected !== ALLOWED_MIME[file.mimetype]) {
      throw new BadRequestException({
        code: 'E-UPLOAD-014',
        message: `File content (${detected}) does not match declared mime (${file.mimetype})`,
        details: { detected, declared: file.mimetype },
      });
    }
    // 最小尺寸校验（仅最小，无上限 + 无 1:1 约束，凭证/评价图任意比例）
    try {
      const r = imageSize(file.buffer);
      if (!r.width || !r.height) {
        throw new BadRequestException({
          code: 'E-UPLOAD-015',
          message: 'Unable to read image dimensions (file may be corrupted)',
        });
      }
      if (r.width < MIN_DIMENSION || r.height < MIN_DIMENSION) {
        throw new BadRequestException({
          code: 'E-UPLOAD-016',
          message: `Image dimensions ${r.width}x${r.height} too small, minimum ${MIN_DIMENSION}x${MIN_DIMENSION}`,
          details: { width: r.width, height: r.height, min: MIN_DIMENSION },
        });
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        code: 'E-UPLOAD-018',
        message: `Failed to read image dimensions: ${(err as Error).message}`,
      });
    }
    // key 用 timestamp + 8 字节 hex 随机，不信任客户端文件名
    const ext = detected;
    const rand = randomBytes(4).toString('hex');
    const key = `${options.keyPrefix}${Date.now()}-${rand}.${ext}`;
    // MinIO 故障转 InternalServerErrorException + 日志
    let result;
    try {
      result = await this.storage.uploadFile({
        key,
        buffer: file.buffer,
        contentType: file.mimetype,
      });
    } catch (err) {
      this.logger.error({
        msg: `${options.logLabel}_upload_failed`,
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
      msg: `${options.logLabel}_uploaded`,
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
