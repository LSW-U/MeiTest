/**
 * support-page.ts — 客服工作台页面纯逻辑（node 环境可测）
 *
 * 从 app/(dashboard)/support/page.tsx 提取；页面文件不导出非 Next.js
 * 约定成员（page 模块仅允许 default 等约定导出，tsc .next/types 校验）。
 */

/** 搜索输入是否可发起请求（空输入不发请求） */
export function canSearch(rawInput: string): boolean {
  return rawInput.trim().length > 0;
}

/** 由列表结果取接口返回首条（contains 可能多条命中；排序以后端为准，前端不另排序） */
export function pickMatchedOrder<T>(items: T[]): T | null {
  return items.length > 0 ? items[0] : null;
}

/** 任务时间线节点渲染判定：有时间为「已发生」态，null 为「未发生」态 */
export function timelineState(at: string | null): 'done' | 'pending' {
  return at ? 'done' : 'pending';
}

/** riderId 短格式（前 8 位）——订单卡避免裸 UUID 长串 */
export function shortRiderId(riderId: string): string {
  return riderId.slice(0, 8);
}

/** 多语言评论文本取值（zh→en→其余首值 fallback 链，与订单详情页 displayName 同款） */
export function pickI18nText(value: Record<string, string> | null | undefined): string {
  if (!value) return '';
  return value.zh ?? value.en ?? Object.values(value)[0] ?? '';
}

// ===== 批3（客服平台扩展 20261018）：单框智能分派 + 人级同页视图 =====

/** 搜索视图状态机：search 搜索引导 → user 人级视图 → order 订单证据链视图 */
export type SupportView = 'search' | 'user' | 'order';

/**
 * 单框智能分派（方案 v2 决策1）：MM 前缀（大小写不敏感）→ 订单链路；其余 → 用户链路
 * 空输入不可分派（与 canSearch 一致，调用方守卫）。
 */
export function dispatchSearchKind(rawInput: string): 'order' | 'user' | null {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) return null;
  return /^MM/i.test(trimmed) ? 'order' : 'user';
}

/** 人选择列表判定：>1 人列表选择，=1 直接进人视图，0 未命中（v2 §六） */
export function userPickIntent(count: number): 'list' | 'direct' | 'none' {
  if (count > 1) return 'list';
  if (count === 1) return 'direct';
  return 'none';
}

/** 人级订单列表默认容量（最近 10 单 + 加载更多，方案 v2 决策4） */
export const USER_ORDERS_PAGE_SIZE = 10;

/** 地址簿卡默认直出条数（微任务 20261018：默认前 3，其余收进「显示更多」） */
export const ADDRESS_PREVIEW_COUNT = 3;

/** 地址簿切片：≤3 全显；>3 时展开显全部、收起显前 3（返回可见列表 + 是否有折叠余量） */
export function visibleAddresses<T>(
  addresses: T[],
  expanded: boolean,
  previewCount = ADDRESS_PREVIEW_COUNT,
): { items: T[]; hasMore: boolean; hiddenCount: number } {
  const hasMore = addresses.length > previewCount;
  if (expanded || !hasMore) {
    return { items: addresses, hasMore, hiddenCount: 0 };
  }
  return {
    items: addresses.slice(0, previewCount),
    hasMore,
    hiddenCount: addresses.length - previewCount,
  };
}
