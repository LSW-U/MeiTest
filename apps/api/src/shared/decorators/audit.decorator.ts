/**
 * @Audit() 装饰器：标记需要审计的 controller 方法
 *
 * 默认行为（不显式 @Audit）：所有 POST/PUT/PATCH/DELETE 自动审计
 * 用 @Audit({ skip: true }) 跳过审计（如高频内部 API）
 *
 * resource 必填（不传时报 'Unknown'，minified 后不可靠，要求显式声明）
 *   @Audit({ resource: 'Order' })
 *
 * resourceIdParam 指定从 request.params 哪个字段取 ID（默认 'id'）
 *   @Audit({ resource: 'Cart', resourceIdParam: 'cartId' })
 */
import { SetMetadata } from '@nestjs/common';

export interface AuditOptions {
  /** 是否跳过审计（默认 false） */
  skip?: boolean;
  /** 资源类型（如 Order / Product / Stock）；建议必填，否则记为 'Unknown' */
  resource?: string;
  /** 从 request.params 哪个字段取 ID（默认 'id'） */
  resourceIdParam?: string;
  /** 需要从 response 中 mask 的字段（在 DEFAULT_MASK_FIELDS 之上追加） */
  maskFields?: string[];
}

export const AUDIT_KEY = 'audit';
export const Audit = (options: AuditOptions = {}) => SetMetadata(AUDIT_KEY, options);

/**
 * 默认 mask 的敏感字段（精确小写匹配，避免 includes 误杀 tokenType/secretQuestion 等）
 *
 * 注意：必须用全等比较，不能 includes。比如 'token' includes 会误杀 tokenType。
 *
 * review2-fix-2：加 'payoutaccount' — WithdrawalRequest.payoutAccount 含银行账号 PII，
 *   不 mask 会随 @Audit interceptor 写进 AuditLog.after JSON，DB 备份/泄露即 PII 泄露。
 *   mask 后审计仍能看到 channel + account 掩码（如 ***1234），保留审计能力。
 */
export const DEFAULT_MASK_FIELDS = [
  'password',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
  'apikey',
  'clientsecret',
  'idcard',
  'creditcard',
  'cvv',
  'payoutaccount',
];
