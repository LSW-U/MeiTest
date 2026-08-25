/**
 * Client Upload Controller 单测（P13 售后图片 2026-08-10 审查 P2 修复）
 *
 * 覆盖 ClientUploadController.uploadRefundEvidence（POST /api/v1/client/uploads/refund-evidence）：
 *   - 正常上传 jpg/png/webp → 返回 URL + key 格式 refunds/evidence-*
 *   - ⭐ 关键差异（vs 商品图端点）：非正方形通过 / 大尺寸通过 / 100x100 通过（售后凭证任意比例 + 无上限 + MIN=100）
 *   - 尺寸过小（50x50）→ 400
 *   - 不支持的 mime（gif）→ 400
 *   - 未收到文件 / 空文件 → 400
 *   - magic bytes 不是图片（伪装 txt）→ 400
 *   - magic bytes 与 header mime 不一致 → 400
 *   - storage.uploadFile 抛 StorageError → 500（E-UPLOAD-001）
 *   - storage.uploadFile 抛普通 Error → 500（E-UPLOAD-002）
 *   - key 含时间戳 + 8 位 hex 随机 + refunds/evidence- 前缀
 *
 * 对比 upload.controller.test.ts（商品图端点）：商品图 200-2000px + 1:1，售后 100 最小 + 无上限 + 任意比例。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ClientUploadController } from '../src/modules/upload/upload-client.controller';

const { mockStorage, MockStorageError } = vi.hoisted(() => ({
  mockStorage: {
    uploadFile: vi.fn(),
  },
  MockStorageError: class extends Error {
    constructor(message: string, public cause?: unknown) {
      super(message);
      this.name = 'StorageError';
    }
  },
}));

vi.mock('../src/shared/storage/storage.service', () => ({
  StorageService: class {
    uploadFile = mockStorage.uploadFile;
  },
  StorageError: MockStorageError,
}));

import { StorageError } from '../src/shared/storage/storage.service';

const FIXTURES = join(__dirname, 'fixtures');
const JPG_600 = readFileSync(join(FIXTURES, 'test-600x600.jpg'));
const PNG_600 = readFileSync(join(FIXTURES, 'test-600x600.png'));
const WEBP_300 = readFileSync(join(FIXTURES, 'test-300x300.webp'));
const JPG_100 = readFileSync(join(FIXTURES, 'test-100x100.jpg'));
const JPG_2500 = readFileSync(join(FIXTURES, 'test-2500x2500.jpg'));
const JPG_800x600 = readFileSync(join(FIXTURES, 'test-800x600.jpg'));
const JPG_50 = readFileSync(join(FIXTURES, 'test-50x50.jpg'));

const FAKE_TXT = Buffer.from('this is not actually a jpeg');

describe('ClientUploadController.uploadRefundEvidence', () => {
  let controller: ClientUploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new ClientUploadController(mockStorage as never);
  });

  const fakeFile = (mimetype: string, buffer: Buffer) =>
    ({
      buffer,
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size: buffer.length,
    }) as unknown as Express.Multer.File;

  it('正常上传 jpg（600x600）-> 返回 URL + key refunds/evidence-* 格式', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/refunds/evidence-x.jpg',
      key: 'refunds/evidence-x.jpg',
      bucket: 'meimart',
      size: JPG_600.length,
    });

    const result = await controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_600));

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('http://localhost:9000/meimart/refunds/evidence-x.jpg');
    expect(mockStorage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
        buffer: JPG_600,
      }),
    );
    const actualKey = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(actualKey).toMatch(/^refunds\/evidence-\d{13}-[a-f0-9]{8}\.jpg$/);
  });

  it('正常上传 png -> ext=png', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadRefundEvidence(fakeFile('image/png', PNG_600));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.png$/);
  });

  it('正常上传 webp -> ext=webp', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadRefundEvidence(fakeFile('image/webp', WEBP_300));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.webp$/);
  });

  it('⭐ 非正方形（800x600）-> 通过（关键差异：售后凭证任意比例，vs 商品图端点拒）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_800x600));
    expect(mockStorage.uploadFile).toHaveBeenCalled();
  });

  it('⭐ 大尺寸（2500x2500）-> 通过（关键差异：无 MAX_DIMENSION，vs 商品图端点拒）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_2500));
    expect(mockStorage.uploadFile).toHaveBeenCalled();
  });

  it('⭐ 100x100 边界 -> 通过（关键差异：MIN_DIMENSION=100 含边界，vs 商品图端点 200 拒）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_100));
    expect(mockStorage.uploadFile).toHaveBeenCalled();
  });

  it('尺寸过小（50x50 < 100）-> 抛 BadRequest + E-UPLOAD-016', async () => {
    try {
      await controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_50));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { code: string };
      expect(resp.code).toBe('E-UPLOAD-016');
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('不支持的 mime header（gif + jpg 内容）-> controller 直调时 magic 一致性先触发 E-UPLOAD-014（fileFilter 层 E-UPLOAD-010 仅在 multer 管线生效）', async () => {
    // 注意：单测直接调 controller 方法绕过 multer fileFilter，故走的是 uploadImage 的
    // magic 一致性校验（E-UPLOAD-014）。真实请求经 multer fileFilter 才会命中 E-UPLOAD-010。
    try {
      await controller.uploadRefundEvidence(fakeFile('image/gif', JPG_600));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { code: string };
      expect(resp.code).toBe('E-UPLOAD-014');
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('未收到文件 -> 抛 BadRequest + E-UPLOAD-011', async () => {
    try {
      await controller.uploadRefundEvidence(undefined);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { code: string };
      expect(resp.code).toBe('E-UPLOAD-011');
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('空文件（0 字节）-> 抛 BadRequest + E-UPLOAD-012', async () => {
    try {
      await controller.uploadRefundEvidence(fakeFile('image/jpeg', Buffer.alloc(0)));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { code: string };
      expect(resp.code).toBe('E-UPLOAD-012');
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 不是图片（伪装 txt）-> 抛 BadRequest + E-UPLOAD-013', async () => {
    try {
      await controller.uploadRefundEvidence(fakeFile('image/jpeg', FAKE_TXT));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { code: string };
      expect(resp.code).toBe('E-UPLOAD-013');
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 与 header mime 不一致 -> 抛 BadRequest + E-UPLOAD-014', async () => {
    // header 说 png，实际内容是 jpg
    try {
      await controller.uploadRefundEvidence(fakeFile('image/png', JPG_600));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const resp = (e as BadRequestException).getResponse() as { code: string };
      expect(resp.code).toBe('E-UPLOAD-014');
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('storage.uploadFile 抛 StorageError -> 抛 InternalServerError（E-UPLOAD-001）', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new StorageError('MinIO down'));
    await expect(
      controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_600)),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('storage.uploadFile 抛普通 Error -> 也转 InternalServerError（E-UPLOAD-002）', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new Error('unknown'));
    await expect(
      controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_600)),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('key 含 refunds/evidence- 前缀 + 时间戳 + 8 位 hex 随机', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadRefundEvidence(fakeFile('image/jpeg', JPG_600));
    const key = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(key).toMatch(/^refunds\/evidence-\d{13}-[a-f0-9]{8}\.jpg$/);
  });
});

/**
 * P15 B2：评价图上传（2026-08-11）
 * 与 refund-evidence 完全同模式（magic bytes / size / 尺寸 / storage 错误），
 * 仅 key 前缀差异（reviews/image- vs refunds/evidence-）。
 * 不重复 15 用例，只覆盖差异点 + 核心校验链路（校验逻辑共用 helpers 已被 refund-evidence 充分覆盖）。
 */
describe('ClientUploadController.uploadReviewImage', () => {
  let controller: ClientUploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new ClientUploadController(mockStorage as never);
  });

  const fakeFile = (mimetype: string, buffer: Buffer) =>
    ({
      buffer,
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size: buffer.length,
    }) as unknown as Express.Multer.File;

  it('⭐ 正常上传 jpg -> key reviews/image-* 前缀（关键差异：vs refund-evidence 的 refunds/evidence-）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/reviews/image-x.jpg',
      key: 'reviews/image-x.jpg',
      bucket: 'meimart',
      size: JPG_600.length,
    });
    const result = await controller.uploadReviewImage(fakeFile('image/jpeg', JPG_600));
    expect(result.success).toBe(true);
    expect(result.data.url).toBe('http://localhost:9000/meimart/reviews/image-x.jpg');
    const key = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(key).toMatch(/^reviews\/image-\d{13}-[a-f0-9]{8}\.jpg$/);
  });

  it('正常上传 png/webp -> ext 对', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadReviewImage(fakeFile('image/png', PNG_600));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.png$/);
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadReviewImage(fakeFile('image/webp', WEBP_300));
    expect(mockStorage.uploadFile.mock.calls[1][0].key).toMatch(/\.webp$/);
  });

  it('非正方形（800x600）-> 通过（同 refund-evidence：评价图任意比例）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadReviewImage(fakeFile('image/jpeg', JPG_800x600));
    expect(mockStorage.uploadFile).toHaveBeenCalled();
  });

  it('尺寸过小（50x50 < 100）-> 抛 BadRequest（同 refund-evidence MIN_DIMENSION=100）', async () => {
    await expect(
      controller.uploadReviewImage(fakeFile('image/jpeg', JPG_50)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 与 header mime 不一致 -> 抛 BadRequest', async () => {
    await expect(
      controller.uploadReviewImage(fakeFile('image/png', JPG_600)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('storage.uploadFile 抛 StorageError -> 抛 InternalServerError（E-UPLOAD-001）', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new StorageError('MinIO down'));
    await expect(
      controller.uploadReviewImage(fakeFile('image/jpeg', JPG_600)),
    ).rejects.toThrow(InternalServerErrorException);
  });
});

/**
 * P22 F2：反馈截图上传（2026-08-19）
 * 与 review-image 完全同模式（校验逻辑共用 uploadImage helper 已被充分覆盖），
 * 仅 key 前缀差异（feedbacks/image-）。止血孤儿文件：反馈图隔离到 feedbacks/ 前缀。
 */
describe('ClientUploadController.uploadFeedbackImage', () => {
  let controller: ClientUploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new ClientUploadController(mockStorage as never);
  });

  const fakeFile = (mimetype: string, buffer: Buffer) =>
    ({
      buffer,
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size: buffer.length,
    }) as unknown as Express.Multer.File;

  it('⭐ 正常上传 jpg -> key feedbacks/image-* 前缀（关键差异：vs review-image 的 reviews/image-）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/feedbacks/image-x.jpg',
      key: 'feedbacks/image-x.jpg',
      bucket: 'meimart',
      size: JPG_600.length,
    });
    const result = await controller.uploadFeedbackImage(fakeFile('image/jpeg', JPG_600));
    expect(result.success).toBe(true);
    expect(result.data.url).toBe('http://localhost:9000/meimart/feedbacks/image-x.jpg');
    const key = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(key).toMatch(/^feedbacks\/image-\d{13}-[a-f0-9]{8}\.jpg$/);
  });

  it('非正方形（800x600）-> 通过（反馈截图任意比例，同 review-image）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadFeedbackImage(fakeFile('image/jpeg', JPG_800x600));
    expect(mockStorage.uploadFile).toHaveBeenCalled();
  });

  it('尺寸过小（50x50 < 100）-> 抛 BadRequest（同 review-image MIN_DIMENSION=100）', async () => {
    await expect(
      controller.uploadFeedbackImage(fakeFile('image/jpeg', JPG_50)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 与 header mime 不一致 -> 抛 BadRequest', async () => {
    await expect(
      controller.uploadFeedbackImage(fakeFile('image/png', JPG_600)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('storage.uploadFile 抛 StorageError -> 抛 InternalServerError（E-UPLOAD-001）', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new StorageError('MinIO down'));
    await expect(
      controller.uploadFeedbackImage(fakeFile('image/jpeg', JPG_600)),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
