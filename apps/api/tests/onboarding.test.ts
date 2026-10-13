/**
 * Onboarding 批1 单测 — spec 四条对应（引导页内容可配置，2026-10-14）
 *
 * 覆盖：
 *   ① @Public 匿名可达 — controller 装配层（@Public 装饰器在 ClientOnboardingController 类级，
 *      运行时由 JwtAuthGuard 消费；本测试验证 client 端点不依赖 req.user、返回 { success, data } 信封）
 *   ② admin 无 SUPER_ADMIN 被拒（403）— @Roles('SUPER_ADMIN') 装饰器装配验证
 *      （RBAC guard 运行时行为由既有 rbac e2e 覆盖；此层验证装饰器元数据正确）
 *   ③ 空配置返回 [] — service listEnabledSlides 空表
 *   ④ slide-image 非法尺寸/比例被拒 — upload.controller uploadSlideImage 校验链
 *
 * service 层真实 DB 行为由 e2e/联调覆盖（单测 mock db，见 [[meimart-prisma-mock-blindspot]] 教训）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import 'reflect-metadata';

// ---- mock db（仅 service 用；controller 测试不触） ----
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    onboardingSlide: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    isOwnUrl: vi.fn(),
    uploadFile: vi.fn(),
  },
}));

vi.mock('../src/shared/storage/storage.service', () => ({
  StorageService: class {
    isOwnUrl = mockStorage.isOwnUrl;
    uploadFile = mockStorage.uploadFile;
  },
  StorageError: class extends Error {},
}));

import { OnboardingService, LocalizedTextSchema } from '../src/modules/onboarding/onboarding.service';
import {
  ClientOnboardingController,
  AdminOnboardingController,
} from '../src/modules/onboarding/onboarding.controller';
import { UploadController } from '../src/modules/upload/upload.controller';

// ---- 装饰器元数据读取（①② 的装配验证） ----
function getMetadata(key: string, target: object): unknown {
  return Reflect.getMetadata(key, target);
}

describe('spec① @Public 匿名可达 — ClientOnboardingController 装配', () => {
  it('类级 @Public 装饰器存在（IS_PUBLIC metadata=true）', () => {
    // @Public() 实现为 SetMetadata(IS_PUBLIC_KEY, true)（public.decorator.ts）
    expect(getMetadata('isPublic', ClientOnboardingController)).toBe(true);
  });

  it('路由前缀 /api/v1/client/onboarding + GET slides 返回 { success, data } 信封', async () => {
    expect(getMetadata('path', ClientOnboardingController)).toBe('api/v1/client/onboarding');
    const service = { listEnabledSlides: vi.fn().mockResolvedValue([]) };
    const controller = new ClientOnboardingController(service as never);
    const res = await controller.listSlides();
    expect(res).toEqual({ success: true, data: [] });
  });
});

describe('spec② admin 无 SUPER_ADMIN 被拒（403）— AdminOnboardingController 装配', () => {
  it('类级 @Roles 装饰器为 ["SUPER_ADMIN"]', () => {
    expect(getMetadata('roles', AdminOnboardingController)).toEqual(['SUPER_ADMIN']);
  });

  it('client 读取端点类级无 @Roles（匿名不设角色门槛）', () => {
    expect(getMetadata('roles', ClientOnboardingController)).toBeUndefined();
  });
});

describe('spec③ 空配置返回 [] — OnboardingService.listEnabledSlides', () => {
  let service: OnboardingService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new OnboardingService(mockStorage as never);
  });

  it('空表返回 []（客户端回退本地 SLIDES 兜底）', async () => {
    mockDb.onboardingSlide.findMany.mockResolvedValue([]);
    const result = await service.listEnabledSlides();
    expect(result).toEqual([]);
    expect(mockDb.onboardingSlide.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
  });

  it('enabled=false 的行不进 client 结果；orderBy sortOrder asc', async () => {
    mockDb.onboardingSlide.findMany.mockResolvedValue([]);
    await service.listEnabledSlides();
    const arg = mockDb.onboardingSlide.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ enabled: true });
    expect(arg.orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
  });
});

describe('spec④ slide-image 非法尺寸/比例被拒 — UploadController.uploadSlideImage', () => {
  let controller: UploadController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new UploadController(mockStorage as never);
  });

  /** 构造最小合法 PNG buffer（magic bytes 通过），尺寸由 PNG IHDR 决定 */
  function makePng(width: number, height: number): Buffer {
    // PNG 签名 8B + IHDR chunk（长度4 + "IHDR" + width4 + height4 ...）
    const buf = Buffer.alloc(33);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    buf.writeUInt32BE(13, 8); // IHDR data length
    buf.write('IHDR', 12, 'ascii');
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  }

  function makeFile(width: number, height: number): Express.Multer.File {
    return {
      buffer: makePng(width, height),
      mimetype: 'image/png',
      size: 100,
    } as Express.Multer.File;
  }

  it('宽度 < 600 被拒（E-UPLOAD-023）', async () => {
    await expect(controller.uploadSlideImage(makeFile(400, 500))).rejects.toMatchObject({
      response: { code: 'E-UPLOAD-023' },
    });
  });

  it('宽度 > 2000 被拒（E-UPLOAD-023）', async () => {
    await expect(controller.uploadSlideImage(makeFile(2500, 3000))).rejects.toMatchObject({
      response: { code: 'E-UPLOAD-023' },
    });
  });

  it('比例超区间被拒：横幅 2:1（banner 比例，slide 拒收，E-UPLOAD-024）', async () => {
    await expect(controller.uploadSlideImage(makeFile(1200, 600))).rejects.toMatchObject({
      response: { code: 'E-UPLOAD-024' },
    });
  });

  it('比例超区间被拒：过窄竖图 1:2（E-UPLOAD-024）', async () => {
    await expect(controller.uploadSlideImage(makeFile(600, 1200))).rejects.toMatchObject({
      response: { code: 'E-UPLOAD-024' },
    });
  });

  it('合法竖图 600x800（3:4）走 MinIO 上传成功', async () => {
    mockStorage.uploadFile.mockResolvedValue({
      key: 'onboarding/slide-x.png',
      url: 'http://minio/meimart/onboarding/slide-x.png',
      size: 100,
    });
    const res = await controller.uploadSlideImage(makeFile(600, 800));
    expect(res.success).toBe(true);
    expect(res.data.key).toContain('onboarding/slide-');
  });

  it('合法方形 600x600（1:1 带内边界）上传成功', async () => {
    mockStorage.uploadFile.mockResolvedValue({
      key: 'onboarding/slide-y.png',
      url: 'http://minio/meimart/onboarding/slide-y.png',
      size: 100,
    });
    const res = await controller.uploadSlideImage(makeFile(600, 600));
    expect(res.success).toBe(true);
  });

  it('未收到文件被拒', async () => {
    await expect(controller.uploadSlideImage(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('非图片内容（magic bytes 失败）被拒', async () => {
    const file = { buffer: Buffer.from('<html>evil</html>'), mimetype: 'image/png', size: 15 } as Express.Multer.File;
    await expect(controller.uploadSlideImage(file)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('imageUrl 非本服务 URL 被拒（E-ONBOARDING-003，service 层 isOwnUrl 防线）', async () => {
    const service = new OnboardingService(mockStorage as never);
    mockStorage.isOwnUrl.mockReturnValue(false);
    await expect(
      service.createSlide({
        title: { en: 'Welcome' },
        description: { en: 'desc' },
        imageUrl: 'https://evil.com/x.png',
      }),
    ).rejects.toMatchObject({ response: { code: 'E-ONBOARDING-003' } });
  });
});

describe('五语校验（E-ONBOARDING-001）— service validateI18n', () => {
  let service: OnboardingService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new OnboardingService(mockStorage as never);
  });

  it('title 缺 en 被拒', async () => {
    await expect(
      service.createSlide({
        title: { zh: '标题' },
        description: { en: 'desc' },
      }),
    ).rejects.toMatchObject({ response: { code: 'E-ONBOARDING-001' } });
  });

  it('description en 为空串被拒', async () => {
    await expect(
      service.createSlide({
        title: { en: 'Welcome' },
        description: { en: '  ' },
      }),
    ).rejects.toMatchObject({ response: { code: 'E-ONBOARDING-001' } });
  });

  it('键集越界（fr 不在五语）被拒', async () => {
    await expect(
      service.createSlide({
        title: { en: 'Welcome', fr: 'Bonjour' },
        description: { en: 'desc' },
      }),
    ).rejects.toMatchObject({ response: { code: 'E-ONBOARDING-001' } });
  });

  it('五语合法（仅 en，其余缺失）创建成功', async () => {
    mockStorage.isOwnUrl.mockReturnValue(true);
    mockDb.onboardingSlide.create.mockResolvedValue({
      id: 's1',
      icon: null,
      imageUrl: null,
      title: { en: 'Welcome' },
      description: { en: 'desc' },
      sortOrder: 0,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await service.createSlide({
      title: { en: 'Welcome' },
      description: { en: 'desc' },
    });
    expect(res.id).toBe('s1');
    expect(res.enabled).toBe(true);
  });

  it('PATCH 部分字段：未提供 title/description 不触发五语校验（只 toggle enabled）', async () => {
    mockDb.onboardingSlide.findUnique.mockResolvedValue({ id: 's1', enabled: true });
    mockDb.onboardingSlide.update.mockResolvedValue({
      id: 's1',
      icon: null,
      imageUrl: null,
      title: { en: 'Welcome' },
      description: { en: 'desc' },
      sortOrder: 0,
      enabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await service.updateSlide('s1', { enabled: false });
    expect(res.enabled).toBe(false);
  });

  it('PATCH 不存在的 id 被拒（E-ONBOARDING-002）', async () => {
    mockDb.onboardingSlide.findUnique.mockResolvedValue(null);
    await expect(service.updateSlide('nope', { enabled: false })).rejects.toMatchObject({
      response: { code: 'E-ONBOARDING-002' },
    });
  });
});

describe('LocalizedTextSchema（导出复用，批2 admin-web 表单口径对齐）', () => {
  it('en 非空通过；zh/id/pt/tet 缺失允许（前端 fallback en）', () => {
    expect(LocalizedTextSchema.safeParse({ en: 'Apple' }).success).toBe(true);
    expect(LocalizedTextSchema.safeParse({ en: 'Apple', zh: '苹果' }).success).toBe(true);
  });
});
