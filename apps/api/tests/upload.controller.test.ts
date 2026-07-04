/**
 * Upload Controller 单测（W7-feature）
 *
 * 覆盖：
 *   - 正常上传 jpg → 返回 URL
 *   - 正常上传 png → 返回 URL
 *   - 正常上传 webp → 返回 URL
 *   - 不支持的 mime（gif）→ fileFilter 抛 BadRequest
 *   - 未收到文件（file=undefined）→ 抛 BadRequest
 *
 * 注：fileFilter 是 multer 的逻辑，这里直接调 controller.uploadProductImage()
 *     验 mime 在 service 层兜底（ALLOWED_MIME 查表 ext 失败抛错）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UploadController } from '../src/modules/upload/upload.controller';
import { StorageService } from '../src/shared/storage/storage.service';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    uploadFile: vi.fn(),
  },
}));

vi.mock('../src/shared/storage/storage.service', () => ({
  StorageService: class {
    uploadFile = mockStorage.uploadFile;
  },
}));

describe('UploadController.uploadProductImage', () => {
  let controller: UploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new UploadController(mockStorage as never);
  });

  const fakeFile = (mimetype: string, size = 1024) =>
    ({
      buffer: Buffer.alloc(size),
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size,
    }) as unknown as Express.Multer.File;

  it('正常上传 jpg → 返回 URL', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/products/main-x.jpg',
      key: 'products/main-x.jpg',
      bucket: 'meimart',
      size: 1024,
    });

    const result = await controller.uploadProductImage(fakeFile('image/jpeg'));

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('http://localhost:9000/meimart/products/main-x.jpg');
    expect(mockStorage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
        buffer: expect.any(Buffer),
      }),
    );
    const actualKey = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(actualKey).toMatch(/^products\/main-\d+-[a-z0-9]+\.jpg$/);
  });

  it('正常上传 png → ext=png', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'u',
      key: 'k',
      bucket: 'b',
      size: 1,
    });
    await controller.uploadProductImage(fakeFile('image/png'));
    expect(mockStorage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    );
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.png$/);
  });

  it('正常上传 webp → ext=webp', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'u',
      key: 'k',
      bucket: 'b',
      size: 1,
    });
    await controller.uploadProductImage(fakeFile('image/webp'));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.webp$/);
  });

  it('不支持的 mime → 抛 BadRequest', async () => {
    await expect(controller.uploadProductImage(fakeFile('image/gif'))).rejects.toThrow(
      BadRequestException,
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('未收到文件 → 抛 BadRequest', async () => {
    await expect(controller.uploadProductImage(undefined)).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('key 含时间戳 + 6 位随机串，避免重名', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/jpeg'));
    const key = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(key).toMatch(/^products\/main-\d{13}-[a-z0-9]{6}\.jpg$/);
  });
});
