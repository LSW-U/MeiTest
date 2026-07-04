/**
 * Storage Service 单测（W7-fix 审查 #5 补覆盖率）
 *
 * 覆盖：
 *   - loadConfig 缺 env → onModuleInit 不初始化，uploadFile 抛 StorageError
 *   - onModuleInit 正常路径（mock minio Client）
 *   - ensureBucket 不存在 → makeBucket + setBucketPolicy（dev/publicRead=true）
 *   - prod（NODE_ENV=production）→ 不调 setBucketPolicy（publicRead=false）
 *   - uploadFile 调 putObject + 返回拼好的 URL
 *   - uploadFile MinIO 抛错 → 转 StorageError
 *   - getPublicUrl 去尾斜杠 + encodeURIComponent 兜底
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageService, StorageError } from '../src/shared/storage/storage.service';

const { MockMinioClient } = vi.hoisted(() => ({
  MockMinioClient: vi.fn(),
}));

vi.mock('minio', () => ({
  Client: MockMinioClient,
}));

function makeMockClient() {
  return {
    bucketExists: vi.fn(),
    makeBucket: vi.fn(),
    setBucketPolicy: vi.fn(),
    putObject: vi.fn(),
  };
}

const ENV_BACKUP = { ...process.env };

describe('StorageService', () => {
  let service: StorageService;
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
    // 必须用普通 function（箭头函数不能 new）— mockImplementation 接收的 fn 会被当构造器调
    MockMinioClient.mockImplementation(function () {
      return mockClient;
    });
    service = new StorageService();
    // 默认 dev 配置
    process.env = {
      ...ENV_BACKUP,
      NODE_ENV: 'development',
      OSS_ENDPOINT: 'http://localhost:9000',
      OSS_ACCESS_KEY: 'minioadmin',
      OSS_SECRET_KEY: 'minioadmin',
      OSS_BUCKET: 'meimart',
    };
  });

  afterEach(() => {
    process.env = ENV_BACKUP;
  });

  describe('onModuleInit', () => {
    it('env 不全 → 不初始化，不抛错（启动不阻断）', async () => {
      delete process.env.OSS_ENDPOINT;
      await service.onModuleInit();
      // uploadFile 会抛 StorageError
      await expect(
        service.uploadFile({ key: 'x', buffer: Buffer.alloc(1), contentType: 'image/jpeg' }),
      ).rejects.toThrow(StorageError);
    });

    it('bucket 不存在 → makeBucket + setBucketPolicy（dev publicRead=true）', async () => {
      mockClient.bucketExists.mockResolvedValueOnce(false);
      mockClient.setBucketPolicy.mockResolvedValueOnce(undefined);
      mockClient.makeBucket.mockResolvedValueOnce(undefined);

      await service.onModuleInit();

      expect(mockClient.makeBucket).toHaveBeenCalledWith('meimart', 'us-east-1');
      expect(mockClient.setBucketPolicy).toHaveBeenCalledWith('meimart', expect.any(String));
      const policy = JSON.parse(mockClient.setBucketPolicy.mock.calls[0][1]);
      expect(policy.Statement[0].Action).toContain('s3:GetObject');
    });

    it('bucket 已存在 → 跳过 makeBucket，仍设 policy（dev）', async () => {
      mockClient.bucketExists.mockResolvedValueOnce(true);
      mockClient.setBucketPolicy.mockResolvedValueOnce(undefined);

      await service.onModuleInit();

      expect(mockClient.makeBucket).not.toHaveBeenCalled();
      expect(mockClient.setBucketPolicy).toHaveBeenCalledTimes(1);
    });

    it('NODE_ENV=production → 不调 setBucketPolicy（publicRead=false）', async () => {
      process.env.NODE_ENV = 'production';
      mockClient.bucketExists.mockResolvedValueOnce(true);

      await service.onModuleInit();

      expect(mockClient.setBucketPolicy).not.toHaveBeenCalled();
    });

    it('OSS_PUBLIC_READ=false 显式覆盖 dev 默认', async () => {
      process.env.OSS_PUBLIC_READ = 'false';
      mockClient.bucketExists.mockResolvedValueOnce(true);

      await service.onModuleInit();

      expect(mockClient.setBucketPolicy).not.toHaveBeenCalled();
    });

    it('ensureBucket MinIO 故障 → 不抛（启动不阻断）', async () => {
      mockClient.bucketExists.mockRejectedValueOnce(new Error('MinIO down'));
      await service.onModuleInit();
      // 不抛 + 不阻断启动
      expect(true).toBe(true);
    });
  });

  describe('uploadFile', () => {
    beforeEach(async () => {
      mockClient.bucketExists.mockResolvedValueOnce(true);
      mockClient.setBucketPolicy.mockResolvedValueOnce(undefined);
      await service.onModuleInit();
    });

    it('调 putObject + 返回拼好的 URL', async () => {
      mockClient.putObject.mockResolvedValueOnce(undefined);
      const result = await service.uploadFile({
        key: 'products/main-123.jpg',
        buffer: Buffer.from('fake-jpeg'),
        contentType: 'image/jpeg',
      });
      expect(mockClient.putObject).toHaveBeenCalledWith(
        'meimart',
        'products/main-123.jpg',
        expect.any(Buffer),
        expect.any(Number),
        { 'Content-Type': 'image/jpeg' },
      );
      expect(result.url).toBe('http://localhost:9000/meimart/products/main-123.jpg');
      expect(result.bucket).toBe('meimart');
      expect(result.size).toBe(9);
    });

    it('MinIO putObject 抛错 → 转 StorageError', async () => {
      mockClient.putObject.mockRejectedValueOnce(new Error('network down'));
      await expect(
        service.uploadFile({
          key: 'x',
          buffer: Buffer.alloc(1),
          contentType: 'image/jpeg',
        }),
      ).rejects.toThrow(StorageError);
    });
  });

  describe('getPublicUrl', () => {
    it('endpoint 去尾斜杠 + 路径分隔符保留', async () => {
      mockClient.bucketExists.mockResolvedValueOnce(true);
      mockClient.setBucketPolicy.mockResolvedValueOnce(undefined);
      await service.onModuleInit();
      const url = service.getPublicUrl('products/main-123.jpg');
      expect(url).toBe('http://localhost:9000/meimart/products/main-123.jpg');
      // 路径分隔符 / 不被 encode
      expect(url).not.toContain('%2F');
    });

    it('endpoint 有尾斜杠 → 去掉防双斜杠', async () => {
      process.env.OSS_ENDPOINT = 'http://localhost:9000/';
      const service2 = new StorageService();
      const client2 = makeMockClient();
      MockMinioClient.mockImplementation(function () {
        return client2;
      });
      client2.bucketExists.mockResolvedValueOnce(true);
      client2.setBucketPolicy.mockResolvedValueOnce(undefined);
      await service2.onModuleInit();
      const url = service2.getPublicUrl('products/main.jpg');
      expect(url).toBe('http://localhost:9000/meimart/products/main.jpg');
      expect(url).not.toContain('//meimart');
    });
  });
});
