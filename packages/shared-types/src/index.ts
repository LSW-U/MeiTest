/**
 * @meimart/shared-types 入口
 *
 * 从 packages/api-contract/openapi.yaml 自动生成的 TS 类型 re-export。
 * 改 schema 流程：改 packages/api-contract/src/schemas/*.ts → gen:openapi → 本包 gen:types。
 *
 * 手写的辅助类型（错误码枚举、通用类型别名）放 src/manual.ts，与本文件一起 export。
 */
export * from './api-types';
