/**
 * 错误码枚举（W1-D5-T2 决策）
 *
 * 格式：E-<MODULE>-<NNN>（如 E-AUTH-001 / E-ORDER-042 / E-PAYMENT-003）
 *
 * 决策依据：
 * - CLAUDE.md L137：错误码格式 E-AUTH-001 / E-ORDER-042 / E-PAYMENT-003
 * - CLAUDE.md L121：后端抛错用错误码，前端查 i18n key 显示
 * - CLAUDE.md L121：errors.json 翻译文件在 shared-locales
 *
 * 使用：
 *   import { ErrorCodes } from '@meimart/shared-types';
 *   throw new ForbiddenException({
 *     code: ErrorCodes.E_AUTH_001,
 *     message: 'Device type mismatch',
 *     details: { ... },
 *   });
 *
 * 前端通过 errors.{code} 查 i18n key（如 errors.E-AUTH-001）
 */

export const ErrorCodes = {
  /** 设备类型不匹配（client token 调 admin 等） */
  E_AUTH_001: 'E-AUTH-001',
  /** 未认证（无/无效 JWT） */
  E_AUTH_002: 'E-AUTH-002',
  /** Token 已过期 */
  E_AUTH_003: 'E-AUTH-003',
  /** Token 无效（payload 不完整等） */
  E_AUTH_004: 'E-AUTH-004',
  /** Refresh token 无效或已过期 */
  E_AUTH_005: 'E-AUTH-005',
  /** Refresh token 已被 logout 黑名单 */
  E_AUTH_006: 'E-AUTH-006',
  /** 禁止访问（无 authenticated user） */
  E_AUTH_007: 'E-AUTH-007',
  /** 端点未声明 @Roles() 或 @Public()（least privilege 默认拒绝） */
  E_AUTH_008: 'E-AUTH-008',
  /** Mock 用户未找到（dev/staging） */
  E_AUTH_009: 'E-AUTH-009',
  /** 角色权限不足 */
  E_AUTH_010: 'E-AUTH-010',

  /** 参数校验失败（zod/class-validator） */
  E_COMMON_001: 'E-COMMON-001',
  /** 服务器内部错误（兜底 500） */
  E_COMMON_002: 'E-COMMON-002',
  /** 未找到资源（404） */
  E_COMMON_003: 'E-COMMON-003',
  /** 请求过于频繁（429） */
  E_COMMON_004: 'E-COMMON-004',

  /** 收货地址超出配送范围 */
  E_ORDER_001: 'E-ORDER-001',
  /** 库存不足 */
  E_ORDER_002: 'E-ORDER-002',
  /** 订单状态不允许此操作 */
  E_ORDER_003: 'E-ORDER-003',
  /** 订单未找到 */
  E_ORDER_004: 'E-ORDER-004',

  /** 支付方式不支持 */
  E_PAYMENT_001: 'E-PAYMENT-001',
  /** 支付超时 */
  E_PAYMENT_002: 'E-PAYMENT-002',
  /** 支付失败 */
  E_PAYMENT_003: 'E-PAYMENT-003',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** 错误码正则（用于 ErrorResponse schema 收紧） */
export const ERROR_CODE_REGEX = /^E-[A-Z]+-\d{3}$/;

/** 所有错误码列表（用于前端 i18n key 校验 / 测试） */
export const ALL_ERROR_CODES: ErrorCode[] = Object.values(ErrorCodes);

/** HTTP 状态码兜底格式（E-HTTP-200/404/500 等） */
export const HTTP_ERROR_CODE_REGEX = /^E-HTTP-\d{3}$/;
