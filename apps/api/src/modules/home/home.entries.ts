/**
 * 首页活动入口配置常量（PromoDock 常驻 4 入口，路线 A 代码常量不建表）
 *
 * 三概念分离：活动入口（此配置）≠ Banner 轮播（catalog.Banner）≠ Promotion 优惠券（promotion.Promotion）。
 * 改入口 = 改此常量 + 部署（无需前端发版）。未来运营化迁 system_config 表（pricing 模块已规划）。
 *
 * link 治理（需求 §5，不接受点击进空页）：
 * - deals    -> /product/list（热销榜，后端 /client/products 默认 salesCount 序）
 * - coupons  -> /coupons（可达，/client/coupons）
 * - delivery -> /coupons?type=FREE_DELIVERY（免邮券，后端 /client/coupons 接 type 筛选；注意该端点需 CUSTOMER 登录）
 * - points   -> /profile（可达，/client/user/profile 返 points）
 *
 * titleKey 对应跨 repo MeiMart1.0 locales 的 home 块（P3 客户端补 5 语言 en/id/zh/pt/tet）。
 * theme/icon 是前端资源（色板 promotionThemes.ts / Material Symbols），后端只传枚举名/图标名。
 */
import { z } from 'zod';
import { HomeEntry } from '@meimart/api-contract';

export type HomeEntryData = z.infer<typeof HomeEntry>;

export const HOME_ENTRIES: HomeEntryData[] = [
  {
    id: 'deals',
    titleKey: 'home.flashDeals',
    icon: 'bolt',
    theme: 'deals',
    link: '/product/list',
    sortOrder: 1,
    status: 'ACTIVE',
  },
  {
    id: 'coupons',
    titleKey: 'home.coupons',
    icon: 'confirmation_number',
    theme: 'coupons',
    link: '/coupons',
    sortOrder: 2,
    status: 'ACTIVE',
  },
  {
    id: 'delivery',
    titleKey: 'home.freeShip',
    icon: 'moped',
    theme: 'delivery',
    link: '/coupons?type=FREE_DELIVERY',
    sortOrder: 3,
    status: 'ACTIVE',
  },
  {
    id: 'points',
    titleKey: 'home.points',
    icon: 'stars',
    theme: 'points',
    link: '/profile',
    sortOrder: 4,
    status: 'ACTIVE',
  },
];
