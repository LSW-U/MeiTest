/**
 * @Audit() 装饰器：标记需要审计的 controller 方法
 *
 * 默认行为（不显式 @Audit）：所有 POST/PUT/PATCH/DELETE 自动审计
 * 用 @Audit({ skip: true }) 跳过审计（如高频内部 API）
 * 用 @Audit({ resource: 'Order' }) 显式指定 resource 类型（默认从 controller 类名推断）
 */
import { SetMetadata } from '@nestjs/common';

export interface AuditOptions {
  /** 是否跳过审计（默认 false） */
  skip?: boolean;
  /** 资源类型（如 Order / Product / Stock）；不传则从 controller 类名推断 */
  resource?: string;
  /** 需要从 response 中 mask 的字段（默认 password / token / secret / authorization） */
  maskFields?: string[];
}

export const AUDIT_KEY = 'audit';
export const Audit = (options: AuditOptions = {}) => SetMetadata(AUDIT_KEY, options);

/** 默认 mask 的敏感字段（小写匹配） */
export const DEFAULT_MASK_FIELDS = [
  'password',
  'token',
  'authorization',
  'secret',
  'apikey',
  'clientsecret',
];
