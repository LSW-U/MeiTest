/**
 * Home 模块 schema（首页活动入口 PromoDock）
 *
 * 路线 A（配置接口，不建表）：后端用代码常量存 4 入口，GET /client/home-entries 返回。
 * 三概念分离：活动入口（本模块）≠ Banner 轮播（catalog）≠ Promotion 优惠券（promotion）。
 *
 * 字段决策：
 * - id 与 theme 对齐（deals/coupons/delivery/points），稳定标识
 * - titleKey（非 I18nText）：配置绑代码，i18n 集中前端 locales（跨 repo MeiMart1.0）
 * - theme 枚举（不传 hex）：色板前端 promotionThemes.ts 维护
 * - link 已治理（不接受点击进空页）：deals->热销榜 /product/list, delivery->免邮券 /coupons?type=FREE_DELIVERY
 */
import { z } from 'zod';

/** 活动入口主题（前端查色板，后端只传枚举名） */
export const HomeEntryTheme = z.enum(['deals', 'coupons', 'delivery', 'points']);

/** 活动入口状态（配置层开关，INACTIVE 不返客户端） */
export const HomeEntryStatus = z.enum(['ACTIVE', 'INACTIVE']);

/** 首页活动入口（PromoDock 常驻 4 入口配置） */
export const HomeEntry = z.object({
  /** 稳定标识（与 theme 对齐：deals/coupons/delivery/points） */
  id: z.string(),
  /** i18n key（如 'home.flashDeals'），前端 t(titleKey) 渲染 */
  titleKey: z.string(),
  /** Material Symbols 图标名 */
  icon: z.string(),
  /** 主题枚举（前端查色板，不传 hex） */
  theme: HomeEntryTheme,
  /** 跳转路径（已治理：deals->/product/list, delivery->/coupons?type=FREE_DELIVERY） */
  link: z.string(),
  /** 排序（升序） */
  sortOrder: z.number().int(),
  /** 配置层开关（client 端 service 过滤 ACTIVE，不返此字段） */
  status: HomeEntryStatus.optional(),
});
