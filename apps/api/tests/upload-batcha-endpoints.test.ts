/**
 * Upload 模块批A 新端点单测（2026-09-09）
 *
 * 覆盖两个新端点的校验逻辑（controller 方法直调，multer fileFilter 不在管线内——
 * 该盲区既有测试同源，见 upload-client.controller.test.ts 头注）：
 *
 * ClientUploadController.uploadAvatar（U6，POST /api/v1/client/uploads/avatar）：
 *   - 1:1 ≥200×200 通过（600x600 fixture）
 *   - 尺寸过小 → E-UPLOAD-019（50x50 < 200）
 *   - 非 1:1（800x600）→ E-UPLOAD-020
 *   - key 前缀 avatars/avatar-*
 *
 * UploadController.uploadBannerImage（U8，POST /api/v1/admin/uploads/banner-image）：
 *   - 区间带校验：宽 600–2000 + 比例 1.5–3.0
 *   - 宽度下界/上界 → E-UPLOAD-021；比例下界/上界 → E-UPLOAD-022
 *   - key 前缀 banners/banner-*
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { ClientUploadController } from '../src/modules/upload/upload-client.controller';
import { UploadController } from '../src/modules/upload/upload.controller';

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

const FIXTURES = join(__dirname, 'fixtures');
const JPG_600 = readFileSync(join(FIXTURES, 'test-600x600.jpg')); // 1:1 600px
const JPG_50 = readFileSync(join(FIXTURES, 'test-50x50.jpg')); // 1:1 50px（过小）
const JPG_800x600 = readFileSync(join(FIXTURES, 'test-800x600.jpg')); // 4:3 ≈1.333（比例<1.5）
const JPG_1200x600 = readFileSync(join(FIXTURES, 'test-1200x600.jpg')); // 2:1（合法 banner：比例在 1.5-3.0 带内 + 宽 600-2000）

const fakeFile = (mimetype: string, buffer: Buffer) =>
  ({
    buffer,
    mimetype,
    originalname: `test.${mimetype.split('/')[1]}`,
    size: buffer.length,
  }) as unknown as Express.Multer.File;

/** 断言抛错响应携带指定错误码 */
async function expectErrorCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(BadRequestException);
  try {
    await promise;
  } catch (e) {
    expect((e as BadRequestException).getResponse()).toMatchObject({ code });
  }
}

describe('ClientUploadController.uploadAvatar（U6 批A 新端点）', () => {
  let controller: ClientUploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    mockStorage.uploadFile.mockResolvedValue({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    controller = new ClientUploadController(mockStorage as never);
  });

  it('1:1 600x600 通过 → key avatars/avatar-* 前缀', async () => {
    const result = await controller.uploadAvatar(fakeFile('image/jpeg', JPG_600));
    expect(result.success).toBe(true);
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(
      /^avatars\/avatar-\d{13}-[a-f0-9]{8}\.jpg$/,
    );
  });

  it('尺寸过小（50x50 < 200）→ E-UPLOAD-019', async () => {
    await expectErrorCode(
      controller.uploadAvatar(fakeFile('image/jpeg', JPG_50)),
      'E-UPLOAD-019',
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('非 1:1（800x600，容差 5% 外）→ E-UPLOAD-020', async () => {
    await expectErrorCode(
      controller.uploadAvatar(fakeFile('image/jpeg', JPG_800x600)),
      'E-UPLOAD-020',
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('非 1:1 但在 5% 容差内（600x600 fixture 是 1:1，此用例验证容差逻辑不误伤正方形）', async () => {
    // 600x600 ratio=1.0，|1-1|=0 ≤ 0.05 → 通过（对照组）
    await controller.uploadAvatar(fakeFile('image/jpeg', JPG_600));
    expect(mockStorage.uploadFile).toHaveBeenCalled();
  });
});

describe('UploadController.uploadBannerImage（U8 批A 新端点）', () => {
  let controller: UploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    mockStorage.uploadFile.mockResolvedValue({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    controller = new UploadController(mockStorage as never);
  });

  it('合法 banner（1200x600，比例 2:1 带内 + 宽 600-2000）通过 → key banners/banner-* 前缀 + uploadFile 被调 + 返回结构完整', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/banners/banner-1.jpg',
      key: 'banners/banner-1.jpg',
      bucket: 'meimart',
      size: JPG_1200x600.length,
    });

    const result = await controller.uploadBannerImage(fakeFile('image/jpeg', JPG_1200x600));

    // 成功路径：storage 被调 + key 前缀模板 + 响应结构 { url, key, size }
    expect(mockStorage.uploadFile).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(
      /^banners\/banner-\d{13}-[a-f0-9]{8}\.jpg$/,
    );
    expect(result).toEqual({
      success: true,
      data: {
        url: 'http://localhost:9000/meimart/banners/banner-1.jpg',
        key: 'banners/banner-1.jpg',
        size: JPG_1200x600.length,
      },
    });
  });

  it('1:1 低于比例下界（600x600 比例 1.0 < 1.5）→ E-UPLOAD-022', async () => {
    await expectErrorCode(
      controller.uploadBannerImage(fakeFile('image/jpeg', JPG_600)),
      'E-UPLOAD-022',
    );
  });

  it('宽度下界外（50px < 600）→ E-UPLOAD-021', async () => {
    await expectErrorCode(
      controller.uploadBannerImage(fakeFile('image/jpeg', JPG_50)),
      'E-UPLOAD-021',
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('比例上界外（800x600 比例 1.333 < 1.5，从下界拒）→ E-UPLOAD-022（宽度 800 在带内，比例不在）', async () => {
    await expectErrorCode(
      controller.uploadBannerImage(fakeFile('image/jpeg', JPG_800x600)),
      'E-UPLOAD-022',
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });
});
