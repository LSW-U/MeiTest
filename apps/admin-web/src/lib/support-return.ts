/**
 * support-return.ts — 客服直达导航纯逻辑（导航优化批1 20261018，方案v1 §二）
 *
 * 从 SupportReturnBar / 六卡链接提取可测纯逻辑；node 环境可测（同 support-cards.ts 模式）。
 * 职责：from=support 参数追加（卡片侧）/ 解析（目标页侧）+ 过滤参数 → 筛选器初始值映射。
 * 本文件零 React 依赖，组件层见 components/common/support-return-bar.tsx。
 */

/** 直达链接来源标记（卡片 → 目标页，其它入口不带此参数零感知） */
export const SUPPORT_FROM_VALUE = 'support';

/**
 * 给直达链接追加 `from=support`（方案v1 §二2：六卡统一）。
 * 已有 query 用 & 连接（C2 ?status=PENDING 变 ?status=PENDING&from=support）；
 * 已带 from=support 幂等不重复加。
 */
export function withFromSupport(href: string): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('from', SUPPORT_FROM_VALUE);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * 解析目标页 ?from= 参数：仅 'support' 判真（方案v1 §二1：无参数/其它值零渲染返回条）。
 */
export function isFromSupport(raw: string | null): boolean {
  return raw === SUPPORT_FROM_VALUE;
}

/**
 * 过滤参数 → 筛选器初始值（方案v1 §二3：只作默认值不锁死——
 * 仅采纳目标页合法枚举值，非法/缺失返回 null，调用方回退自身默认）。
 * 目标页 useState 初始化调用（仅首挂载读一次），用户手改后不受影响。
 */
export function pickStatusParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T | null {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}
