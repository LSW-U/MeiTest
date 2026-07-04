/**
 * Upload Controller 单测（W7-feature + W7-fix 审查修复）
 *
 * 覆盖：
 *   - 正常上传 jpg/png/webp → 返回 URL
 *   - 不支持的 mime（gif）→ 400
 *   - 未收到文件 → 400
 *   - 空文件（0 字节）→ 400
 *   - magic bytes 与 header mime 不一致 → 400
 *   - magic bytes 不是图片（伪装 txt）→ 400
 *   - storage.uploadFile 抛 StorageError → 500
 *   - key 含时间戳 + 8 位 hex 随机
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { UploadController } from '../src/modules/upload/upload.controller';

const { mockStorage, MockStorageError } = vi.hoisted(() => ({
  mockStorage: {
    uploadFile: vi.fn(),
  },
  // 必须在 hoisted 内定义，避免 vi.mock factory 引用顶层 import（hoisting 报错）
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
}))

// 用 mocked 模块的 StorageError（即 MockStorageError）— 走 import 让 TS 知道类型
import { StorageError } from '../src/shared/storage/storage.service';

describe('UploadController.uploadProductImage', () => {
  let controller: UploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new UploadController(mockStorage as never);
  });

  /** 真 magic bytes 帮助函数 */
  const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const PNG_HEAD = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
  ]);
  const WEBP_HEAD = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const FAKE_TXT = Buffer.from('this is not actually a jpeg');

  const fakeFile = (mimetype: string, buffer: Buffer) =>
    ({
      buffer,
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size: buffer.length,
    }) as unknown as Express.Multer.File;

  it('正常上传 jpg → 返回 URL', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/products/main-x.jpg',
      key: 'products/main-x.jpg',
      bucket: 'meimart',
      size: JPEG_HEAD.length,
    });

    const result = await controller.uploadProductImage(fakeFile('image/jpeg', JPEG_HEAD));

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('http://localhost:9000/meimart/products/main-x.jpg');
    expect(mockStorage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
        buffer: JPEG_HEAD,
      }),
    );
    const actualKey = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(actualKey).toMatch(/^products\/main-\d{13}-[a-f0-9]{8}\.jpg$/);
  });

  it('正常上传 png → ext=png', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/png', PNG_HEAD));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.png$/);
  });

  it('正常上传 webp → ext=webp', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/webp', WEBP_HEAD));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.webp$/);
  });

  it('不支持的 mime header → 抛 BadRequest（fileFilter 层）', async () => {
    // fileFilter 在 multer 拦截器层，单测这里直接调 controller，
    // 假设 fileFilter 通过后到 controller，但 mime 不在白名单 → controller 也会拒
    await expect(controller.uploadProductImage(fakeFile('image/gif', JPEG_HEAD))).rejects.toThrow(
      BadRequestException,
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('未收到文件 → 抛 BadRequest', async () => {
    await expect(controller.uploadProductImage(undefined)).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('空文件（0 字节）→ 抛 BadRequest', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', Buffer.alloc(0))),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 不是图片（伪装 txt）→ 抛 BadRequest', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', FAKE_TXT)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 与 header mime 不一致 → 抛 BadRequest', async () => {
    // header 说 png，实际内容是 jpg
    await expect(
      controller.uploadProductImage(fakeFile('image/png', JPEG_HEAD)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('storage.uploadFile 抛 StorageError → 抛 InternalServerError', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new StorageError('MinIO down'));
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPEG_HEAD)),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('storage.uploadFile 抛普通 Error → 也转 InternalServerError', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new Error('unknown'));
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPEG_HEAD)),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('key 含时间戳 + 8 位 hex 随机（crypto.randomBytes）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/jpeg', JPEG_HEAD));
    const key = mockStorage.uploadFile.mock.calls[0][0].key;
    // 8 位 hex（randomBytes(4).toString('hex') = 8 chars）
    expect(key).toMatch(/^products\/main-\d{13}-[a-f0-9]{8}\.jpg$/);
  });
});
