/**
 * Storage Service — MinIO/S3 对象存储封装
 *
 * 用法：
 *   const url = await storage.uploadFile({
 *     key: `products/${productId}/main-${Date.now()}.jpg`,
 *     buffer: file.buffer,
 *     contentType: 'image/jpeg',
 *   });
 *   // url = "http://localhost:9000/meimart/products/xxx/main-1789xxx.jpg"
 *
 * 设计：
 * - 启动时 ensureBucket() — bucket 不存在则创建 + 设 public-read policy（dev 方便直接拉图）
 * - uploadFile 直传 buffer，无服务端压缩（MVP 简化，后续可加 sharp）
 * - getPublicUrl 拼完整 URL：`${OSS_ENDPOINT}/${OSS_BUCKET}/${key}`
 * - DB 存完整 URL（前端直接 src= 用），切 prod 时改 OSS_ENDPOINT 即可
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';

export interface UploadFileInput {
  /** 存储路径，例 `products/8a3f/main-1789xxx.jpg` */
  key: string;
  /** 文件内容 */
  buffer: Buffer;
  /** MIME 类型，例 `image/jpeg` */
  contentType: string;
}

export interface UploadFileResult {
  url: string;
  key: string;
  bucket: string;
  size: number;
}

interface MinioConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

function loadConfig(): MinioConfig | null {
  const endpoint = process.env.OSS_ENDPOINT;
  const accessKey = process.env.OSS_ACCESS_KEY;
  const secretKey = process.env.OSS_SECRET_KEY;
  const bucket = process.env.OSS_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) return null;
  return { endpoint, accessKey, secretKey, bucket };
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: Client;
  private bucket?: string;
  private endpoint?: string;

  async onModuleInit(): Promise<void> {
    const cfg = loadConfig();
    if (!cfg) {
      this.logger.warn('OSS_* env 不全，StorageService 功能受限（上传会失败）');
      return;
    }

    const url = new URL(cfg.endpoint);
    const endPoint = url.hostname;
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    const useSSL = url.protocol === 'https:';

    this.client = new Client({
      endPoint,
      port,
      useSSL,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
    });
    this.bucket = cfg.bucket;
    this.endpoint = cfg.endpoint;

    await this.ensureBucket();
  }

  /** 启动时确保 bucket 存在 + 设 public-read（dev 方便前端直接拉图） */
  private async ensureBucket(): Promise<void> {
    if (!this.client || !this.bucket) return;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, 'us-east-1');
        this.logger.log(`bucket created: ${this.bucket}`);
      }
      // anonymous read policy（前端 <img src> 直接用）
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      };
      await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
    } catch (err) {
      this.logger.error(`ensureBucket 失败: ${(err as Error).message}`);
    }
  }

  async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
    if (!this.client || !this.bucket || !this.endpoint) {
      throw new Error('StorageService 未初始化（OSS_* env 不全）');
    }
    await this.client.putObject(this.bucket, input.key, input.buffer, input.buffer.length, {
      'Content-Type': input.contentType,
    });
    return {
      url: this.getPublicUrl(input.key),
      key: input.key,
      bucket: this.bucket,
      size: input.buffer.length,
    };
  }

  getPublicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }
}
