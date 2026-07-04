/**
 * Storage Service — MinIO/S3 对象存储封装
 *
 * 用法：
 *   const url = await storage.uploadFile({
 *     key: `products/main-${Date.now()}-${rand}.jpg`,
 *     buffer: file.buffer,
 *     contentType: 'image/jpeg',
 *   });
 *   // url = "http://localhost:9000/meimart/products/main-xxx.jpg"
 *
 * 设计：
 * - 启动时 ensureBucket() — bucket 不存在则创建
 * - dev 自动设 public-read policy（方便前端 <img src> 直接拉）
 * - prod 跳过 public-read policy（用私有 bucket + CDN 签名 URL，未来补 presignedGetObject）
 * - uploadFile 直传 buffer，无服务端压缩（MVP 简化，后续可加 sharp）
 * - getPublicUrl 拼完整 URL：`${OSS_ENDPOINT}/${OSS_BUCKET}/${key}`，key 经 encodeURIComponent 兜底
 * - DB 存完整 URL（前端直接 src= 用），切 prod 时改 OSS_ENDPOINT 即可
 * - key 不绑 productId（前端先上传拿 URL，再提交 product 表单）
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';

export interface UploadFileInput {
  /** 存储路径，例 `products/main-1789xxx-abcd1234.jpg` */
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

/** Storage 层抛错基类（用于上层 controller 区分 storage 错误 vs 其他错误） */
export class StorageError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

interface MinioConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  /** 是否启动时设 public-read policy（dev=true / prod=false） */
  publicRead: boolean;
}

function loadConfig(): MinioConfig | null {
  const endpoint = process.env.OSS_ENDPOINT;
  const accessKey = process.env.OSS_ACCESS_KEY;
  const secretKey = process.env.OSS_SECRET_KEY;
  const bucket = process.env.OSS_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) return null;
  // #3 prod 不设 public-read，用私有 bucket + CDN 签名 URL
  // 显式 env 覆盖：OSS_PUBLIC_READ=false 强制关（即使 dev 也可关）
  const isProd = process.env.NODE_ENV === 'production';
  const envFlag = process.env.OSS_PUBLIC_READ;
  const publicRead = envFlag !== undefined ? envFlag === 'true' : !isProd;
  return { endpoint, accessKey, secretKey, bucket, publicRead };
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: Client;
  private bucket?: string;
  private endpoint?: string;
  private publicRead = false;

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
    this.publicRead = cfg.publicRead;

    await this.ensureBucket();
  }

  /**
   * 启动时确保 bucket 存在
   * dev: + 设 public-read policy（前端 <img src> 直接用）
   * prod: 跳过 policy（用私有 bucket + CDN 签名 URL）
   */
  private async ensureBucket(): Promise<void> {
    if (!this.client || !this.bucket) return;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, 'us-east-1');
        this.logger.log(`bucket created: ${this.bucket}`);
      }
      if (this.publicRead) {
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
        this.logger.log(`bucket public-read policy set: ${this.bucket}`);
      } else {
        this.logger.log(`bucket private (no public-read policy): ${this.bucket}`);
      }
    } catch (err) {
      this.logger.error(`ensureBucket 失败: ${(err as Error).message}`);
      // 不抛 — 让上传时再炸，启动不阻断
    }
  }

  async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
    if (!this.client || !this.bucket || !this.endpoint) {
      throw new StorageError('StorageService 未初始化（OSS_* env 不全）');
    }
    try {
      await this.client.putObject(
        this.bucket,
        input.key,
        input.buffer,
        input.buffer.length,
        { 'Content-Type': input.contentType },
      );
    } catch (err) {
      throw new StorageError(`MinIO putObject 失败: ${(err as Error).message}`, err);
    }
    return {
      url: this.getPublicUrl(input.key),
      key: input.key,
      bucket: this.bucket,
      size: input.buffer.length,
    };
  }

  /** 拼接公开访问 URL；endpoint 去尾斜杠防双斜杠，key encode 兜底未来含中文/空格 */
  getPublicUrl(key: string): string {
    const base = (this.endpoint ?? '').replace(/\/$/, '');
    return `${base}/${this.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
    // 注：key 路径分隔符 / 不 encode，只 encode 文件名部分的特殊字符
    // 实际 key 由服务端生成（products/main-{ts}-{rand8}.{ext}），字符集安全，
    // encodeURIComponent 兜底是防御性的，未来若 key 含中文也不会断 URL
  }
}
