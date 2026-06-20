/**
 * MinIO 对象存储（dev/staging）
 *
 * 决策依据：CLAUDE.md §技术栈
 *   - dev/staging：MinIO（自托管，与 S3 协议兼容）
 *   - prod：阿里云 OSS（W6 申），接口换 OSS SDK
 *
 * 用途：商品图 / 用户头像 / 银行转账凭证
 */
import { Client as MinioClient } from 'minio';

const globalForMinio = globalThis as unknown as { minio?: MinioClient };

function createMinio(): MinioClient {
  const endPoint = (process.env.OSS_ENDPOINT ?? 'http://localhost:9000').replace(/^https?:\/\//, '');
  const [host, portStr] = endPoint.split(':');
  const port = Number(portStr ?? 9000);
  const useSSL = (process.env.OSS_ENDPOINT ?? '').startsWith('https');

  return new MinioClient({
    endPoint: host,
    port,
    useSSL,
    accessKey: process.env.OSS_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.OSS_SECRET_KEY ?? 'minioadmin',
  });
}

export const minio: MinioClient = globalForMinio.minio ?? createMinio();

if (process.env.NODE_ENV !== 'production') {
  globalForMinio.minio = minio;
}

/** 默认 bucket 名 */
export const DEFAULT_BUCKET = process.env.OSS_BUCKET ?? 'meimart';

/**
 * 上传文件并返回访问 URL
 *
 * @param objectKey 存储路径（如 `users/abc/avatar.jpg`）
 * @param buffer 文件内容
 * @param contentType MIME 类型
 * @returns 访问 URL（dev 是 MinIO 公网 URL，prod 是 CDN URL）
 */
export async function uploadFile(
  objectKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const bucketExists = await minio.bucketExists(DEFAULT_BUCKET);
  if (!bucketExists) {
    await minio.makeBucket(DEFAULT_BUCKET, 'us-east-1');
    // dev 环境开放匿名读（方便前端访问）
    if (process.env.NODE_ENV !== 'production') {
      await minio.setBucketPolicy(
        DEFAULT_BUCKET,
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${DEFAULT_BUCKET}/*`],
            },
          ],
        }),
      );
    }
  }

  await minio.putObject(DEFAULT_BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': contentType,
  });

  // 返回访问 URL（dev：MinIO 直链；prod：CDN 域名）
  const endpoint = process.env.OSS_ENDPOINT ?? 'http://localhost:9000';
  const publicHost = process.env.OSS_PUBLIC_HOST ?? endpoint;
  return `${publicHost}/${DEFAULT_BUCKET}/${objectKey}`;
}

/**
 * 删除文件
 */
export async function deleteFile(objectKey: string): Promise<void> {
  await minio.removeObject(DEFAULT_BUCKET, objectKey);
}

/**
 * 生成预签名上传 URL（前端直传场景，如大文件）
 */
export async function presignUpload(
  objectKey: string,
  expireSeconds = 15 * 60,
): Promise<string> {
  return minio.presignedPutObject(DEFAULT_BUCKET, objectKey, expireSeconds);
}
