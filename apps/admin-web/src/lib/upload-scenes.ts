/**
 * 场景化上传封装（upload 模块批A，2026-09-09）
 *
 * 场景注册表：每个图片上传场景一个 entry（端点 + 前端约束说明），
 * 调用方只报场景名，不再各自硬编码端点路径。底层仍走 apiUploadFile
 * （fetch + CSRF + X-Perspective + Accept-Language + 401 重定向）。
 *
 * 图片场景 6 个：
 *   - product-main-create / product-main-edit：商品主图（product-image，1:1 200-2000px）
 *   - product-image-wall：商品图片墙（product-image，批C 图片墙底层调用替换，交互不动）
 *   - category-icon：分类图标（product-image，1:1 约束一致——U7 拍板不开新口子）
 *   - banner：banner 宽幅图（banner-image，宽 600-2000px + 比例 1.5:1-3:1——U7/U8/U9 拍板）
 * 非图片场景（CSV 导入）：inventory-import / products-import 两调用点
 * 仍直调 apiUploadFile（须带各自 mode/query 参数，YAGNI 不进注册表——批A 审查 P3-4）。
 *
 * 前端不做尺寸/比例预校验（A4 对照表成稿后批B 落地统一 util），约束由后端
 * 逐端点强校验；此处仅锚定端点映射，防止再出现借道端点的语义污染。
 */
import { apiUploadFile, type ApiSuccess } from '@/lib/api';

/** 上传响应 data（所有图片上传端点共用同构响应） */
export interface UploadResultData {
  url: string;
  key: string;
  size: number;
}

/** 图片上传场景注册表：场景名 → 端点路径 */
export const UPLOAD_SCENES = {
  /** 商品创建 · 主图 */
  'product-main-create': '/api/v1/admin/uploads/product-image',
  /** 商品编辑 · 主图 */
  'product-main-edit': '/api/v1/admin/uploads/product-image',
  /** 商品图片墙（多图） */
  'product-image-wall': '/api/v1/admin/uploads/product-image',
  /** 分类图标（U7：维持挂 product-image，1:1 约束一致） */
  'category-icon': '/api/v1/admin/uploads/product-image',
  /** banner 宽幅图（U8：独立端点，宽 600-2000px + 比例 1.5:1-3:1） */
  banner: '/api/v1/admin/uploads/banner-image',
} as const;

export type UploadScene = keyof typeof UPLOAD_SCENES;

/**
 * 按场景上传文件。
 *
 * @param scene  场景名（见 UPLOAD_SCENES 注册表）
 * @param file   用户选择的文件
 * @param fieldName multipart field name（默认 'file'，CSV 导入场景由调用方传 'csv' 等）
 */
export async function uploadByScene<T = UploadResultData>(
  scene: UploadScene,
  file: File,
  fieldName = 'file',
): Promise<ApiSuccess<T>> {
  return apiUploadFile<ApiSuccess<T>>(UPLOAD_SCENES[scene], file, fieldName);
}
