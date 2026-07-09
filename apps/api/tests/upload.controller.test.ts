/**
 * Upload Controller 单测（W7-feature + W7-fix 审查修复 + W7-fix 图片尺寸校验）
 *
 * 覆盖：
 *   - 正常上传 jpg/png/webp（600x600 正方形）-> 返回 URL
 *   - 不支持的 mime（gif）-> 400
 *   - 未收到文件 -> 400
 *   - 空文件（0 字节）-> 400
 *   - magic bytes 与 header mime 不一致 -> 400
 *   - magic bytes 不是图片（伪装 txt）-> 400
 *   - 图片尺寸过小（100x100）-> 400
 *   - 图片尺寸过大（2500x2500）-> 400
 *   - 图片比例非 1:1（600x800）-> 400
 *   - storage.uploadFile 抛 StorageError -> 500
 *   - key 含时间戳 + 8 位 hex 随机
 *
 * 使用真实图片 fixture（apps/api/tests/fixtures/）- imageSize 需要完整文件头读尺寸
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
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

import { StorageError } from '../src/shared/storage/storage.service';

const FIXTURES = join(__dirname, 'fixtures');
const JPG_600 = readFileSync(join(FIXTURES, 'test-600x600.jpg'));
const PNG_600 = readFileSync(join(FIXTURES, 'test-600x600.png'));
const WEBP_300 = readFileSync(join(FIXTURES, 'test-300x300.webp'));
const JPG_100 = readFileSync(join(FIXTURES, 'test-100x100.jpg'));
const JPG_2500 = readFileSync(join(FIXTURES, 'test-2500x2500.jpg'));
const JPG_600x800 = readFileSync(join(FIXTURES, 'test-800x600.jpg')); // 实际 600x800（sips -z 顺序）

const FAKE_TXT = Buffer.from('this is not actually a jpeg');

describe('UploadController.uploadProductImage', () => {
  let controller: UploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new UploadController(mockStorage as never);
  });

  const fakeFile = (mimetype: string, buffer: Buffer) =>
    ({
      buffer,
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size: buffer.length,
    }) as unknown as Express.Multer.File;

  it('正常上传 jpg（600x600）-> 返回 URL', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({
      url: 'http://localhost:9000/meimart/products/main-x.jpg',
      key: 'products/main-x.jpg',
      bucket: 'meimart',
      size: JPG_600.length,
    });

    const result = await controller.uploadProductImage(fakeFile('image/jpeg', JPG_600));

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('http://localhost:9000/meimart/products/main-x.jpg');
    expect(mockStorage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image/jpeg',
        buffer: JPG_600,
      }),
    );
    const actualKey = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(actualKey).toMatch(/^products\/main-\d{13}-[a-f0-9]{8}\.jpg$/);
  });

  it('正常上传 png（600x600）-> ext=png', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/png', PNG_600));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.png$/);
  });

  it('正常上传 webp（300x300）-> ext=webp', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/webp', WEBP_300));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.webp$/);
  });

  it('不支持的 mime header -> 抛 BadRequest（fileFilter 层）', async () => {
    await expect(controller.uploadProductImage(fakeFile('image/gif', JPG_600))).rejects.toThrow(
      BadRequestException,
    );
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('未收到文件 -> 抛 BadRequest', async () => {
    await expect(controller.uploadProductImage(undefined)).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('空文件（0 字节）-> 抛 BadRequest', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', Buffer.alloc(0))),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 不是图片（伪装 txt）-> 抛 BadRequest', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', FAKE_TXT)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('magic bytes 与 header mime 不一致 -> 抛 BadRequest', async () => {
    // header 说 png，实际内容是 jpg
    await expect(
      controller.uploadProductImage(fakeFile('image/png', JPG_600)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('图片尺寸过小（100x100）-> 抛 BadRequest', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPG_100)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('图片尺寸过大（2500x2500）-> 抛 BadRequest', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPG_2500)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('图片比例非 1:1（600x800）-> 抛 BadRequest（防客户端卡片变形）', async () => {
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPG_600x800)),
    ).rejects.toThrow(BadRequestException);
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('storage.uploadFile 抛 StorageError -> 抛 InternalServerError', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new StorageError('MinIO down'));
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPG_600)),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('storage.uploadFile 抛普通 Error -> 也转 InternalServerError', async () => {
    mockStorage.uploadFile.mockRejectedValueOnce(new Error('unknown'));
    await expect(
      controller.uploadProductImage(fakeFile('image/jpeg', JPG_600)),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('key 含时间戳 + 8 位 hex 随机（crypto.randomBytes）', async () => {
    mockStorage.uploadFile.mockResolvedValueOnce({ url: 'u', key: 'k', bucket: 'b', size: 1 });
    await controller.uploadProductImage(fakeFile('image/jpeg', JPG_600));
    const key = mockStorage.uploadFile.mock.calls[0][0].key;
    expect(key).toMatch(/^products\/main-\d{13}-[a-f0-9]{8}\.jpg$/);
  });
});
