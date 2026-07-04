/**
 * Perspective 定义 + RBAC 映射
 *
 * 决策依据：CLAUDE.md §视角切换（v0.3 决策 J）
 *   - super_admin 同一 JWT，前端切 5 视角（platform / merchant / warehouse / support / rider-mgmt）
 *   - 后端 RBAC 不感知 perspective（只看 role）
 *   - perspective 通过 X-Perspective header 注入，仅供审计
 *
 * 后端视角仅用于：
 *   - 菜单动态渲染（不同视角看不同菜单）
 *   - 路由守卫（无权视角跳转默认）
 *   - 默认落地页
 *
 * 安全：所有数据访问仍由后端 RBAC 兜底；perspective 不构成权限边界。
 */
export const PERSPECTIVES = [
  'platform',
  'merchant',
  'warehouse',
  'support',
  'rider-mgmt',
] as const;

export type Perspective = (typeof PERSPECTIVES)[number];

export const DEFAULT_PERSPECTIVE: Perspective = 'platform';

/** 视角 → 默认落地路径（必须是 app/(dashboard)/ 下实际存在的路由） */
export const PERSPECTIVE_HOME: Record<Perspective, string> = {
  platform: '/dashboard',
  merchant: '/dashboard',
  warehouse: '/dashboard',
  support: '/orders',
  'rider-mgmt': '/riders',
};

/** 视角 → i18n key（platform namespace） */
export const PERSPECTIVE_LABEL_KEY: Record<Perspective, string> = {
  platform: 'platform.perspective.platform',
  merchant: 'platform.perspective.merchant',
  warehouse: 'platform.perspective.warehouse',
  support: 'platform.perspective.support',
  'rider-mgmt': 'platform.perspective.riderMgmt',
};

export function isPerspective(value: unknown): value is Perspective {
  return typeof value === 'string' && (PERSPECTIVES as readonly string[]).includes(value);
}
