/**
 * support-cards.ts — 客服工作台六卡纯逻辑（批1 20261018，方案v2）
 *
 * 从卡片组件提取可测纯逻辑；node 环境可测（同 support-page.ts 模式）。
 * 视角门控（v2 🔴1）：C1/C4/C5 仅 platform；C2/C3/C6 双视角；
 * 卡内直达链接与 sidebar perspectives 联动过滤（不留 403 死链）。
 * 本文件零 React 依赖，组件层见 support/cards/support-cards-grid.tsx。
 */
import { DILI_TIMEZONE } from '@meimart/shared-utils';

export type SupportCardKey = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6';

/** 全部六卡（platform 视角顺序） */
export const ALL_CARD_KEYS: SupportCardKey[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

/**
 * 视角 → 可渲染卡片（v2 决策表 RBAC 拍板）：
 *   platform 全六卡；support 仅 C2/C3/C6（数据源已放宽给 CUSTOMER_SERVICE 的三卡）；
 *   其余视角 /support 不在 sidebar 可见范围，返回空数组（网格整体不渲染）。
 */
export function visibleCardKeys(perspective: string): SupportCardKey[] {
  if (perspective === 'platform') return ALL_CARD_KEYS;
  if (perspective === 'support') return ['c2', 'c3', 'c6'];
  return [];
}

/**
 * 卡片直达目标路径 → sidebar perspectives 白名单（与 sidebar.tsx NAV_ITEMS 逐项对齐）。
 * 唯一真源仍是 sidebar；此处是卡片链接的镜像表，sidebar 改动须同步（同文件注释锚点）。
 */
export const SUPPORT_LINK_PERSPECTIVES: Record<string, readonly string[]> = {
  '/dashboard': ['platform', 'merchant', 'warehouse'],
  '/orders': ['platform', 'merchant', 'warehouse', 'support'],
  '/refunds': ['platform', 'merchant', 'support'],
  '/reviews': ['platform', 'merchant', 'support'],
  '/dispatch': ['platform'],
  '/customers': ['platform'],
  '/feedback': ['platform'],
  '/hot-search': ['platform'],
  '/statistics': ['platform'],
};

/** 直达链接视角过滤：不可达返回 null（调用方渲染为纯文本，不渲染死链） */
export function linkTargetForPerspective(href: string, perspective: string): string | null {
  const path = href.split('?')[0];
  const allowed = SUPPORT_LINK_PERSPECTIVES[path];
  if (!allowed || !allowed.includes(perspective)) return null;
  return href;
}

/** 路径 → sidebar 菜单 i18n key（C6 钉选 chip 标签复用 menu.*，不新增重复文案） */
export const SUPPORT_PIN_LABEL_KEY: Record<string, string> = {
  '/dashboard': 'menu.dashboard',
  '/orders': 'menu.orders',
  '/refunds': 'menu.refunds',
  '/reviews': 'menu.reviews',
  '/dispatch': 'menu.dispatch',
  '/customers': 'menu.customers',
  '/feedback': 'menu.feedback',
  '/hot-search': 'menu.hotSearch',
  '/statistics': 'menu.statistics',
};

// ===== C2 计数口径 =====

/** C2 游标分页探测条数（N+ 口径：≤ limit 显示精确数，> limit 显示 N+） */
export const PENDING_PROBE_LIMIT = 5;

/**
 * C2 计数徽章口径（v2 §三3）：refunds/dispatch 游标分页 total optional，
 * 不可依赖 total —— limit=小值探测，hasMore（或取满 limit）→ N+ 口径。
 */
export function countBadge(
  itemsCount: number,
  limit: number,
  hasMore: boolean,
): { mode: 'exact'; count: number } | { mode: 'plus'; count: number } {
  if (hasMore && itemsCount >= limit) return { mode: 'plus', count: limit };
  return { mode: 'exact', count: itemsCount };
}

/**
 * 「今日新反馈」时间窗（东帝汶 Asia/Dili 自然日）→ ISO UTC（Z 结尾）。
 * 契约 IsoTimestamp = z.string().datetime() 不接受 +09:00 偏移量，必须转 Z 形式。
 */
export function diliDayRangeIso(now: Date): { startDate: string; endDate: string } {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: DILI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    startDate: new Date(`${d}T00:00:00+09:00`).toISOString(),
    endDate: new Date(`${d}T23:59:59.999+09:00`).toISOString(),
  };
}

// ===== C3 差评预警 =====

/** 差评条目最小形状（Review 子集） */
export interface BadReviewLike {
  id: string;
  rating: number;
  createdAt: string;
}

/**
 * C3 差评合并：rating=1 与 rating=2 两路查询合并，按 createdAt 降序取前 n（默认 5）。
 * 后端单 rating 值过滤，无「1 或 2」语法，前端合并是唯一解。
 */
export function latestBadReviews<T extends BadReviewLike>(rating1: T[], rating2: T[], n = 5): T[] {
  return [...rating1, ...rating2]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, n);
}

// ===== C5 骑手绩效 =====

/** 骑手绩效条目最小形状（StatisticsRidersResponseItem 子集） */
export interface RiderStatLike {
  riderId: string;
  riderName: string;
  rating: number;
  completedOrders: number;
}

/**
 * C5 BOTTOM3：按 rating 升序取 3（任务书拍板口径）。
 * 接口无排序参数（后端定死 completedOrders desc），BOTTOM 须前端全量自行升序。
 * Array.prototype.sort 在 V8 为稳定排序，rating 并列保持后端原序。
 */
export function riderBottom3<T extends RiderStatLike>(items: T[]): T[] {
  return [...items].sort((a, b) => a.rating - b.rating).slice(0, 3);
}

/** C5 TOP3：后端已按 completedOrders 降序，直接取前 3（不另排序） */
export function riderTop3<T extends RiderStatLike>(items: T[]): T[] {
  return items.slice(0, 3);
}

// ===== C1 sparkline =====

/**
 * 内联 SVG sparkline 点位串（polyline points 属性）。
 * 值域线性映射到 [0, height]（最大值贴顶）；单点/恒值居中；无依赖（铁律不引图表库）。
 */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const n = values.length;
  return values
    .map((v, i) => {
      const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
      const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    })
    .join(' ');
}

// ===== C6 钉选（localStorage admin_support_pins，先例 admin_sidebar_groups 同款） =====

export const SUPPORT_PINS_STORAGE_KEY = 'admin_support_pins';

/** platform 视角默认 6 项（support 视角经 filterPinsForPerspective 收窄） */
export const DEFAULT_PIN_PATHS = ['/orders', '/refunds', '/reviews', '/dispatch', '/customers', '/feedback'];

/**
 * 解析持久化钉选：raw 为 null → null（调用方回退默认 6 项）；
 * 坏 JSON / 非数组 / 含未知路径 → 逐项丢弃（只认 SUPPORT_LINK_PERSPECTIVES 已知路径）。
 */
export function loadPins(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is string => typeof x === 'string' && x in SUPPORT_LINK_PERSPECTIVES,
    );
  } catch {
    return [];
  }
}

/** 钉选按视角过滤（去重保序；不可达页直接剔除，不留死链） */
export function filterPinsForPerspective(pins: string[], perspective: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pins) {
    if (seen.has(p)) continue;
    if (SUPPORT_LINK_PERSPECTIVES[p]?.includes(perspective)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** 默认钉选（按视角过滤后的 DEFAULT_PIN_PATHS） */
export function defaultPins(perspective: string): string[] {
  return filterPinsForPerspective(DEFAULT_PIN_PATHS, perspective);
}

/** 追加钉选（已存在不重复加，返回新数组） */
export function addPin(pins: string[], path: string): string[] {
  return pins.includes(path) ? pins : [...pins, path];
}

/** 移除钉选（返回新数组） */
export function removePin(pins: string[], path: string): string[] {
  return pins.filter((p) => p !== path);
}
