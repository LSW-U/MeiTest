/**
 * 商家（店铺）模块 schema
 *
 * 决策依据：
 * - 业务决策 1：单一商家，shops 表预置 1 条（平台自营），入驻接口留口不开放
 * - CLAUDE.md §多语言：name 用 i18n JSON
 */
import { z } from 'zod';
import { Id, I18nText } from './common';

/** 店铺状态 */
export const ShopStatus = z.enum(['ACTIVE', 'INACTIVE']);

/** 单一商家店铺（MVP 仅 1 条预置） */
export const Shop = z.object({
  id: Id,
  name: I18nText,
  logoUrl: z.string().url().nullable(),
  phone: z.string(),
  address: z.string(),
  status: ShopStatus,
  businessHours: z.string().nullable(),
  announcement: I18nText.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** 修改店铺信息请求（商家视角） */
export const UpdateShopRequest = z.object({
  name: I18nText.optional(),
  logoUrl: z.string().url().nullable().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  status: ShopStatus.optional(),
  businessHours: z.string().nullable().optional(),
  announcement: I18nText.optional(),
});
