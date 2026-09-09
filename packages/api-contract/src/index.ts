/**
 * @meimart/api-contract 入口
 *
 * 单一导出点：所有 zod schema + OpenAPI registry 入口。
 * 改 schema 后跑 `pnpm --filter @meimart/api-contract gen:openapi` 重新生成 OpenAPI。
 */
import { z } from 'zod';

export * from './schemas/common';
export * from './schemas/auth';
export * from './schemas/cart';
export * from './schemas/catalog';
export * from './schemas/dispatch';
export * from './schemas/feedback';
export * from './schemas/geo';
export * from './schemas/home';
export * from './schemas/im';
export * from './schemas/import-log';
export * from './schemas/inventory';
export * from './schemas/order';
export * from './schemas/payment';
export * from './schemas/platform';
export * from './schemas/promotion';
export * from './schemas/rate';
export * from './schemas/refund';
export * from './schemas/review';
export * from './schemas/rider';
export * from './schemas/search';
export * from './schemas/settle';
export * from './schemas/shop';
export * from './schemas/statistics';
export * from './schemas/unified-auth';
export * from './schemas/upload';
// notification 必须在 user 之前导出（user.ts 对 notification schema 做 re-export）
export * from './schemas/notification';
export * from './schemas/user';
export * from './schemas/warehouse';

/**
 * OpenAPI registry 占位（D1-T6 接入 @asteasolutions/zod-to-openapi）
 *
 * 后续在此文件挂 registry.register('LoginRequest', LoginRequest) 等，
 * gen-openapi.ts 脚本会拉 registry 生成 openapi.yaml。
 */
export const ApiContractVersion = z.literal('0.3');
