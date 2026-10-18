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
