/**
 * @meimart/shared-types 入口
 *
 * - api-types：从 packages/api-contract/openapi.yaml 自动生成的 TS 类型
 * - error-codes：手写错误码枚举（E-MODULE-NNN 格式）
 *
 * 改 schema 流程：改 packages/api-contract/src/schemas/*.ts → gen:openapi → 本包 gen:types。
 */
export * from './api-types';
export * from './error-codes';
