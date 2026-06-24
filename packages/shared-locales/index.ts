/**
 * @meimart/shared-locales 入口
 *
 * 三端共享 i18n 翻译资源（en/zh/id/pt/tet）。
 * - en: 完整 ~130 key（baseline）
 * - zh/id/pt: 当前用 en 内容占位，W2 各流程接入时翻译
 * - tet: 复制 en 内容（typecheck 结构一致要求；errors 在 D5-fix 补齐）
 *
 * 决策依据：CLAUDE.md L121 — packages/shared-locales/<lang>/common.json
 *          CLAUDE.md L40/L149/L242 — Tetum 留接口空翻译
 *
 * 用法：
 *   import { messages, SUPPORTED_LOCALES, type Locale } from '@meimart/shared-locales';
 *   const t = messages.zh.errors['E-AUTH-001']; // → "请先登录"
 *
 * frontend fallback 链：lang → en → ""
 */
import enCommon from './en/common.json';
import enAuth from './en/auth.json';
import enUser from './en/user.json';
import enShop from './en/shop.json';
import enWarehouse from './en/warehouse.json';
import enOrder from './en/order.json';
import enPayment from './en/payment.json';
import enCatalog from './en/catalog.json';
import enCart from './en/cart.json';
import enErrors from './en/errors.json';

import zhCommon from './zh/common.json';
import zhAuth from './zh/auth.json';
import zhUser from './zh/user.json';
import zhShop from './zh/shop.json';
import zhWarehouse from './zh/warehouse.json';
import zhOrder from './zh/order.json';
import zhPayment from './zh/payment.json';
import zhCatalog from './zh/catalog.json';
import zhCart from './zh/cart.json';
import zhErrors from './zh/errors.json';

import idCommon from './id/common.json';
import idAuth from './id/auth.json';
import idUser from './id/user.json';
import idShop from './id/shop.json';
import idWarehouse from './id/warehouse.json';
import idOrder from './id/order.json';
import idPayment from './id/payment.json';
import idCatalog from './id/catalog.json';
import idCart from './id/cart.json';
import idErrors from './id/errors.json';

import ptCommon from './pt/common.json';
import ptAuth from './pt/auth.json';
import ptUser from './pt/user.json';
import ptShop from './pt/shop.json';
import ptWarehouse from './pt/warehouse.json';
import ptOrder from './pt/order.json';
import ptPayment from './pt/payment.json';
import ptCatalog from './pt/catalog.json';
import ptCart from './pt/cart.json';
import ptErrors from './pt/errors.json';

import tetCommon from './tet/common.json';
import tetAuth from './tet/auth.json';
import tetUser from './tet/user.json';
import tetShop from './tet/shop.json';
import tetWarehouse from './tet/warehouse.json';
import tetOrder from './tet/order.json';
import tetPayment from './tet/payment.json';
import tetCatalog from './tet/catalog.json';
import tetCart from './tet/cart.json';
import tetErrors from './tet/errors.json';

export const SUPPORTED_LOCALES = ['en', 'zh', 'id', 'pt', 'tet'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** 单语言的所有模块 */
export interface MessagesBundle {
  common: typeof enCommon;
  auth: typeof enAuth;
  user: typeof enUser;
  shop: typeof enShop;
  warehouse: typeof enWarehouse;
  order: typeof enOrder;
  payment: typeof enPayment;
  catalog: typeof enCatalog;
  cart: typeof enCart;
  errors: typeof enErrors;
}

/** 所有语言的翻译（key=语言代码，value=该语言的所有模块 bundle） */
export const messages: Record<Locale, MessagesBundle> = {
  en: {
    common: enCommon,
    auth: enAuth,
    user: enUser,
    shop: enShop,
    warehouse: enWarehouse,
    order: enOrder,
    payment: enPayment,
    catalog: enCatalog,
    cart: enCart,
    errors: enErrors,
  },
  zh: {
    common: zhCommon,
    auth: zhAuth,
    user: zhUser,
    shop: zhShop,
    warehouse: zhWarehouse,
    order: zhOrder,
    payment: zhPayment,
    catalog: zhCatalog,
    cart: zhCart,
    errors: zhErrors,
  },
  id: {
    common: idCommon,
    auth: idAuth,
    user: idUser,
    shop: idShop,
    warehouse: idWarehouse,
    order: idOrder,
    payment: idPayment,
    catalog: idCatalog,
    cart: idCart,
    errors: idErrors,
  },
  pt: {
    common: ptCommon,
    auth: ptAuth,
    user: ptUser,
    shop: ptShop,
    warehouse: ptWarehouse,
    order: ptOrder,
    payment: ptPayment,
    catalog: ptCatalog,
    cart: ptCart,
    errors: ptErrors,
  },
  tet: {
    common: tetCommon,
    auth: tetAuth,
    user: tetUser,
    shop: tetShop,
    warehouse: tetWarehouse,
    order: tetOrder,
    payment: tetPayment,
    catalog: tetCatalog,
    cart: tetCart,
    errors: tetErrors,
  },
};

/** 错误码翻译 bundle（AllExceptionsFilter 用，单层 key/code → message） */
export const errorBundles: Record<Locale, Record<string, string>> = {
  en: enErrors,
  zh: zhErrors,
  id: idErrors,
  pt: ptErrors,
  tet: tetErrors,
};
