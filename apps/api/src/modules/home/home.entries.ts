/**
 * 首页活动入口配置常量（PromoDock 常驻 4 入口，路线 A 代码常量不建表）
 *
 * 三概念分离：活动入口（此配置）≠ Banner 轮播（catalog.Banner）≠ Promotion 优惠券（promotion.Promotion）。
 * 改入口 = 改此常量 + 部署（无需前端发版）。未来运营化迁 system_config 表（pricing 模块已规划）。
 *
 * link 治理（需求 §5，不接受点击进空页）：
 * - deals    -> /product/list（热销榜，后端 /client/products 默认 salesCount 序）
 * - coupons  -> /coupons（可达，/client/coupons）
 * - delivery -> /coupons?type=FREE_DELIVERY（免邮券，⚠️ 需 CUSTOMER 登录）
 * - points   -> /profile（/client/user/profile，⚠️ 需 CUSTOMER 登录）
 * ⚠️ home-entries 端点 @Public，但 coupons/delivery/points 的 link 指向 @Roles('CUSTOMER') 端点，
 *   游客点击会 401。客户端应处理未登录态（跳登录页/隐藏入口）。后端鉴权仍生效（非漏洞，体验断裂）。
 *
 * titleKey 对应跨 repo MeiMart1.0 locales 的 promotion 块（客户端 en/zh/tet 已齐 flashDeals/coupons/freeShip/points）。
 * theme/icon 是前端资源（色板 promotionThemes.ts / Material Symbols），后端只传枚举名/图标名。
 */
import { z } from 'zod';
import { HomeEntry } from '@meimart/api-contract';

export type HomeEntryData = z.infer<typeof HomeEntry>;

export const HOME_ENTRIES: HomeEntryData[] = [
  {
    id: 'deals',
    titleKey: 'promotion.flashDeals',
    icon: 'bolt',
    theme: 'deals',
    link: '/product/list',
    sortOrder: 1,
    status: 'ACTIVE',
  },
  {
    id: 'coupons',
    titleKey: 'promotion.coupons',
    icon: 'confirmation_number',
    theme: 'coupons',
    link: '/coupons',
    sortOrder: 2,
    status: 'ACTIVE',
  },
  {
    id: 'delivery',
    titleKey: 'promotion.freeShip',
    icon: 'moped',
    theme: 'delivery',
    link: '/coupons?type=FREE_DELIVERY',
    sortOrder: 3,
    status: 'ACTIVE',
  },
  {
    id: 'points',
    titleKey: 'promotion.points',
    icon: 'stars',
    theme: 'points',
    link: '/profile',
    sortOrder: 4,
    status: 'ACTIVE',
  },
];
