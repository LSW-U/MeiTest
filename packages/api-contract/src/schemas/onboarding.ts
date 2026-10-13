/**
 * Onboarding 模块 schema（引导页内容可配置，2026-10-14）
 *
 * 独立表 onboarding_slides（方案v2 D1 拍板）：SystemConfig 是 key-value 字符串存储，
 * 不适合结构化多行 slides。icon（Material Symbol 名）/ imageUrl 二选一。
 * title/description 五语 {en,pt,tet,id,zh}，en 必填（服务端校验，缺其他语言前端 fallback en）。
 */
import { z } from 'zod';
import { Id, IsoTimestamp, I18nText } from './common';

/** 引导页 slide 实体 */
export const OnboardingSlide = z.object({
  id: Id,
  /** Material Symbol 图标名（纯文字屏用，与 imageUrl 二选一） */
  icon: z.string().nullable(),
  /** 配图 URL（slide-image 上传端点产出，与 icon 二选一） */
  imageUrl: z.string().nullable(),
  /** 五语标题（en 必填非空） */
  title: I18nText,
  /** 五语描述（en 必填非空） */
  description: I18nText,
  /** 排序（升序） */
  sortOrder: z.number().int(),
  /** 启停（false 不下发客户端） */
  enabled: z.boolean(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 创建 slide 请求（icon/imageUrl 二选一，en 必填由服务端校验） */
export const CreateOnboardingSlideRequest = z.object({
  icon: z.string().min(1).nullable().optional(),
  imageUrl: z.string().min(1).nullable().optional(),
  title: I18nText,
  description: I18nText,
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

/** 修改 slide 请求（部分字段，含 sortOrder/enabled toggle） */
export const UpdateOnboardingSlideRequest = CreateOnboardingSlideRequest.partial();
