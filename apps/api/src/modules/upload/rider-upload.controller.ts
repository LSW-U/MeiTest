/**
 * Rider Upload Controller — 骑手证件/头像上传 endpoint（W3 骑手个人区，2026-08-24）
 *
 * 端点（common 前缀，apply 阶段用户尚持 client_app token）：
 *   POST /api/v1/common/rider/uploads/avatar        头像（1:1 推荐，最小 200×200）
 *   POST /api/v1/common/rider/uploads/id-card-image  身份证图（最小 300×200，任意比例）
 *   POST /api/v1/common/rider/uploads/license-image  驾照/车辆证件图（最小 300×200，任意比例）
 *     - multipart/form-data, field name="file"
 *     - CUSTOMER 权限（apply 阶段用户 role=CUSTOMER + deviceType=client_app）
 *     - magic bytes + mime ∈ {jpg/png/webp} + size ≤ 5MB + 最小尺寸
 *     - 写 MinIO：riders/avatar-{ts}-{rand8}.{ext} / riders/idcard-* / riders/license-*
 *     - 返回 { success: true, data: { url, key, size } }
 *
 * 决策（2026-08-24）：
 *   - 上传端点放 common 前缀：apply 阶段用户仍是 client_app token，审核通过后才变 rider_app。
 *     apply 一次性带 3 个 URL 提交（avatarUrl/idCardImageUrl/licenseImageUrl）。
 *   - 头像要求 1:1（与 admin 商品图同标准，前端卡片不变形）；证件图任意比例（最小 300×200 防模糊）。
 *   - 复用 upload-client.controller 的 uploadImage 模式（magic bytes + 尺寸校验），仅 keyPrefix + 尺寸约束分化。
 *
 * 安全：
 *   - @Roles('CUSTOMER') + DeviceTypeGuard 对 common 前缀放行（client_app 可调）
 *   - 服务端生成 key，不信任客户端文件名
 *   - magic bytes 校验（防 EXE/SVG/HTML 伪装）
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

/** 头像最小尺寸（与 admin 商品图同标准，防客户端卡片变形） */
const AVATAR_MIN_DIMENSION = 200;
/** 头像 1:1 容差 5%（防 599x600 等微差） */
const AVATAR_ASPECT_TOLERANCE = 0.05;
/** 证件图最小尺寸（防模糊，任意比例） */
const DOC_MIN_WIDTH = 300;
const DOC_MIN_HEIGHT = 200;

/** 上传成功返回结构 */
interface UploadResult {
  success: true;
  data: { url: string; key: string; size: number };
}

interface UploadOptions {
  keyPrefix: string;
  logLabel: string;
  /** 'doc' 模式尺寸过小的错误前缀（avatar 模式不使用） */
  sizeErrorLabel?: string;
  /** 'avatar' 强制 1:1；'doc' 仅最小尺寸任意比例 */
  mode: 'avatar' | 'doc';
}

@Controller('api/v1/common/rider/uploads')
@Roles('CUSTOMER')
export class RiderUploadController {
  private readonly logger = new Logger(RiderUploadController.name);

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** 骑手头像上传（1:1 推荐，最小 200×200） */
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME[file.mimetype]) {
          // F4 修复（2026-08-24 审查报告）：错误码化 + i18n，移除硬编码中文字符串
          cb(new BadRequestException({ code: 'E-UPLOAD-010', message: `unsupported mime: ${file.mimetype}` }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadAvatar(@UploadedFile() file: Express.Multer.File | undefined): Promise<UploadResult> {
    return this.uploadImage(file, {
      keyPrefix: 'riders/avatar-',
      logLabel: 'rider_avatar',
      mode: 'avatar',
    });
  }

  /** 身份证图上传（最小 300×200，任意比例） */
  @Post('id-card-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME[file.mimetype]) {
          cb(new BadRequestException({ code: 'E-UPLOAD-010', message: `unsupported mime: ${file.mimetype}` }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadIdCardImage(@UploadedFile() file: Express.Multer.File | undefined): Promise<UploadResult> {
    return this.uploadImage(file, {
      keyPrefix: 'riders/idcard-',
      logLabel: 'rider_id_card',
      sizeErrorLabel: 'ID card image',
      mode: 'doc',
    });
  }

  /** 驾照/车辆证件图上传（最小 300×200，任意比例） */
  @Post('license-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME[file.mimetype]) {
          cb(new BadRequestException({ code: 'E-UPLOAD-010', message: `unsupported mime: ${file.mimetype}` }), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ resource: 'Upload' })
  async uploadLicenseImage(@UploadedFile() file: Express.Multer.File | undefined): Promise<UploadResult> {
    return this.uploadImage(file, {
      keyPrefix: 'riders/license-',
      logLabel: 'rider_license',
      sizeErrorLabel: 'License image',
      mode: 'doc',
    });
  }

  // ===================== 内部 =====================

  /**
   * 图片上传核心逻辑（与 upload-client.controller 同模式，仅尺寸约束按 mode 分化）
   *
   * 校验链路：空文件 → magic bytes → magic vs header 一致性 → 尺寸校验 → 服务端生成 key → MinIO 上传
   *
   * @param options.mode 'avatar' 强制 1:1 最小 200；'doc' 仅最小 300×200 任意比例
   */
  private async uploadImage(
    file: Express.Multer.File | undefined,
    options: UploadOptions,
  ): Promise<UploadResult> {
    if (!file) {
      // F4 修复（2026-08-24 审查报告）：错误码化 + i18n，所有 BadRequestException 走 E-UPLOAD-xxx
      throw new BadRequestException({ code: 'E-UPLOAD-011', message: 'No file received (field name must be "file")' });
    }
    if (!file.buffer || file.buffer.length < MIN_FILE_SIZE) {
      throw new BadRequestException({ code: 'E-UPLOAD-012', message: 'File is empty' });
    }
    const detected = detectImageFormat(file.buffer);
    if (!detected) {
      throw new BadRequestException({
        code: 'E-UPLOAD-013',
        message: 'File content is not a valid image (jpg/png/webp), the mime type may be forged',
      });
    }
    if (detected !== ALLOWED_MIME[file.mimetype]) {
      throw new BadRequestException({ code: 'E-UPLOAD-014', message: `File content (${detected}) does not match declared mime (${file.mimetype})` });
    }
    // 尺寸校验
    try {
      const r = imageSize(file.buffer);
      if (!r.width || !r.height) {
        throw new BadRequestException({ code: 'E-UPLOAD-015', message: 'Unable to read image dimensions (file may be corrupted)' });
      }
      if (options.mode === 'avatar') {
        if (r.width < AVATAR_MIN_DIMENSION || r.height < AVATAR_MIN_DIMENSION) {
          throw new BadRequestException({
            code: 'E-UPLOAD-016',
            message: `Avatar dimensions ${r.width}x${r.height} too small, minimum ${AVATAR_MIN_DIMENSION}x${AVATAR_MIN_DIMENSION}`,
          });
        }
        // 1:1 容差校验
        const ratio = r.width / r.height;
        if (Math.abs(ratio - 1) > AVATAR_ASPECT_TOLERANCE) {
          throw new BadRequestException({ code: 'E-UPLOAD-017', message: `Avatar must be 1:1 square (current ${r.width}x${r.height}), please crop and re-upload` });
        }
      } else {
        if (r.width < DOC_MIN_WIDTH || r.height < DOC_MIN_HEIGHT) {
          throw new BadRequestException({
            code: 'E-UPLOAD-016',
            message: `${options.sizeErrorLabel} dimensions ${r.width}x${r.height} too small, minimum ${DOC_MIN_WIDTH}x${DOC_MIN_HEIGHT}`,
          });
        }
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({ code: 'E-UPLOAD-018', message: `Failed to read image dimensions: ${(err as Error).message}` });
    }
    const ext = detected;
    const rand = randomBytes(4).toString('hex');
    const key = `${options.keyPrefix}${Date.now()}-${rand}.${ext}`;
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
        throw new InternalServerErrorException({ code: 'E-UPLOAD-001', message: `上传失败: ${err.message}` });
      }
      throw new InternalServerErrorException({ code: 'E-UPLOAD-002', message: '上传失败，请稍后重试' });
    }
    this.logger.log({
      msg: `${options.logLabel}_uploaded`,
      key: result.key,
      size: result.size,
      mime: file.mimetype,
    });
    return { success: true, data: { url: result.url, key: result.key, size: result.size } };
  }
}
