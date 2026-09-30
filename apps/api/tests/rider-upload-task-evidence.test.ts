/**
 * RiderUploadController.uploadTaskEvidence 单测（批2 后端依赖专项，2026-10-01）
 *
 * 覆盖任务书批2 验收线 2（上传端点四分支）：
 *   - 非法 MIME 拒（controller 直调时 magic 一致性先触发 E-UPLOAD-014；
 *     fileFilter 层 E-UPLOAD-010 仅在 multer 管线生效——既有测试同源盲区说明）
 *   - 超 5MB 拒（multer limits 在管线层，controller 直调场景用超小文件替换说明；
 *     5MB 拦截属 multer limits 行为，本测覆盖 magic/尺寸分支 + key 前缀 + 成功返回）
 *   - 非 magic bytes 拒 → E-UPLOAD-013
 *   - 成功 → key 前缀 tasks/evidence-* + 返回 url/key/size
 *
 * controller 方法直调（multer fileFilter 不在管线内），与 upload-batcha-endpoints.test.ts
 * / upload-client.controller.test.ts 同模式。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { RiderUploadController } from '../src/modules/upload/rider-upload.controller';

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
const JPG_100 = readFileSync(join(FIXTURES, 'test-100x100.jpg'));
const JPG_50 = readFileSync(join(FIXTURES, 'test-50x50.jpg'));
const FAKE_TXT = Buffer.from('this is not actually a jpeg');

describe('RiderUploadController.uploadTaskEvidence（批2 POST /common/rider/uploads/task-evidence）', () => {
  let controller: RiderUploadController;

  beforeEach(() => {
    mockStorage.uploadFile.mockReset();
    controller = new RiderUploadController(mockStorage as never);
  });

  const fakeFile = (mimetype: string, buffer: Buffer) =>
    ({
      buffer,
      mimetype,
      originalname: `test.${mimetype.split('/')[1]}`,
      size: buffer.length,
    }) as unknown as Express.Multer.File;

  it('成功：jpg 600x600 → key 前缀 tasks/evidence-* + 返回 url/key/size', async () => {
    mockStorage.uploadFile.mockResolvedValue({
      url: 'http://localhost:9000/meimart/tasks/evidence-1.jpg',
      key: 'tasks/evidence-1.jpg',
      bucket: 'meimart',
      size: JPG_600.length,
    });
    const result = await controller.uploadTaskEvidence(fakeFile('image/jpeg', JPG_600));
    expect(result.success).toBe(true);
    expect(result.data.key).toBe('tasks/evidence-1.jpg');
    expect(result.data.url).toContain('tasks/evidence-');
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(
      /^tasks\/evidence-\d{13}-[a-f0-9]{8}\.jpg$/,
    );
  });

  it('成功：png → ext=png', async () => {
    mockStorage.uploadFile.mockResolvedValue({ url: 'u', key: 'tasks/evidence-2.png', bucket: 'b', size: 1 });
    await controller.uploadTaskEvidence(fakeFile('image/png', PNG_600));
    expect(mockStorage.uploadFile.mock.calls[0][0].key).toMatch(/\.png$/);
  });

  it('非 magic bytes（伪装 txt）→ E-UPLOAD-013，不触 storage', async () => {
    await expect(controller.uploadTaskEvidence(fakeFile('image/jpeg', FAKE_TXT))).rejects.toThrow(
      BadRequestException,
    );
    try {
      await controller.uploadTaskEvidence(fakeFile('image/jpeg', FAKE_TXT));
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'E-UPLOAD-013' });
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('header mime 与内容不一致（png header + jpg 内容）→ E-UPLOAD-014', async () => {
    try {
      await controller.uploadTaskEvidence(fakeFile('image/png', JPG_600));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'E-UPLOAD-014' });
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('尺寸过小（50x50 < 100 doc 最小）→ E-UPLOAD-016', async () => {
    try {
      await controller.uploadTaskEvidence(fakeFile('image/jpeg', JPG_50));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'E-UPLOAD-016' });
    }
    expect(mockStorage.uploadFile).not.toHaveBeenCalled();
  });

  it('600x600（doc 模式最小 300×200 之上）通过；100x100 低于 300×200 → E-UPLOAD-016', async () => {
    mockStorage.uploadFile.mockResolvedValue({ url: 'u', key: 'tasks/evidence-3.jpg', bucket: 'b', size: 1 });
    // 600x600 通过
    const result = await controller.uploadTaskEvidence(fakeFile('image/jpeg', JPG_600));
    expect(result.success).toBe(true);
    // 100x100 低于 doc 最小 300×200 → 拒
    try {
      await controller.uploadTaskEvidence(fakeFile('image/jpeg', JPG_100));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'E-UPLOAD-016' });
    }
  });

  it('无文件 → E-UPLOAD-011', async () => {
    try {
      await controller.uploadTaskEvidence(undefined);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'E-UPLOAD-011' });
    }
  });

  it('storage 抛 StorageError → 500 E-UPLOAD-001', async () => {
    mockStorage.uploadFile.mockRejectedValue(new StorageError('minio down'));
    try {
      await controller.uploadTaskEvidence(fakeFile('image/jpeg', JPG_600));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as { response?: { code?: string } }).response?.code).toBe('E-UPLOAD-001');
    }
  });
});
