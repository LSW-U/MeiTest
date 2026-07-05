/**
 * Upload 模块 schema（W7-feature 商品图片上传）
 *
 * 端点：POST /api/v1/admin/uploads/product-image
 *   - multipart/form-data，field name="file"
 *   - 支持 jpg/png/webp，size ≤ 5MB
 *   - 服务端校验 magic bytes（防 mime 伪造）
 *   - key 服务端生成：products/main-{ts}-{rand8hex}.{ext}
 *
 * 响应返回完整公开 URL（dev public-read bucket），前端直接 <img src> 用。
 */
import { z } from 'zod';

/** Upload 响应 data */
export const UploadResponseData = z.object({
  /** 公开访问 URL（dev: http://localhost:9000/meimart/products/main-xxx.jpg） */
  url: z.string().url(),
  /** 存储路径，例 products/main-1789xxx-abcd1234.jpg */
  key: z.string(),
  /** 文件大小（字节） */
  size: z.number().int().nonnegative(),
});

/** 成功响应包装：{ success: true, data: UploadResponseData } */
export const UploadResponse = z.object({
  success: z.literal(true),
  data: UploadResponseData,
});
