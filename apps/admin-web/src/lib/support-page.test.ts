/**
 * support-page 纯逻辑单测（批3，客服平台扩展 20261018）
 *
 * 测试环境 = node（无 jsdom/RTL，铁律不引第三方依赖），
 * 沿用「纯逻辑提取 + 断言」模式（同 evidence-image-group.test.ts）。
 */
import { describe, it, expect } from 'vitest';
import {
  canSearch,
  pickMatchedOrder,
  timelineState,
  shortRiderId,
  pickI18nText,
  dispatchSearchKind,
  userPickIntent,
  USER_ORDERS_PAGE_SIZE,
  visibleAddresses,
  type SupportView,
} from './support-page';

describe('canSearch（批1 回归）', () => {
  it('空串/纯空白不可搜索', () => {
    expect(canSearch('')).toBe(false);
    expect(canSearch('   ')).toBe(false);
  });
  it('非空可搜索', () => {
    expect(canSearch('MM2026')).toBe(true);
    expect(canSearch(' 张三 ')).toBe(true);
  });
});

describe('dispatchSearchKind（批3 单框智能分派，v2 决策1）', () => {
  it('① MM 前缀（大写）→ order', () => {
    expect(dispatchSearchKind('MM2026061901000234')).toBe('order');
  });
  it('② mm 前缀（小写，大小写不敏感）→ order', () => {
    expect(dispatchSearchKind('mm20260619')).toBe('order');
  });
  it('③ 纯数字手机号 → user（MM 字母前缀与手机号不冲突）', () => {
    expect(dispatchSearchKind('77012345')).toBe('user');
  });
  it('④ 姓名中文 → user', () => {
    expect(dispatchSearchKind('张三')).toBe('user');
  });
  it('⑤ 邮箱 → user', () => {
    expect(dispatchSearchKind('user@example.com')).toBe('user');
  });
  it('⑥ 前后空白 trim 后判定', () => {
    expect(dispatchSearchKind('  MM123  ')).toBe('order');
  });
  it('⑦ 空输入 → null（不可分派）', () => {
    expect(dispatchSearchKind('')).toBe(null);
    expect(dispatchSearchKind('   ')).toBe(null);
  });
  it('⑧ MM 出现在中间（非前缀）→ user', () => {
    expect(dispatchSearchKind('XMM123')).toBe('user');
  });
});

describe('userPickIntent（批3 命中分流，v2 §六）', () => {
  it('0 命中 → none（未命中态）', () => {
    expect(userPickIntent(0)).toBe('none');
  });
  it('1 命中 → direct（直接进人视图）', () => {
    expect(userPickIntent(1)).toBe('direct');
  });
  it('多人 → list（人选择列表）', () => {
    expect(userPickIntent(2)).toBe('list');
    expect(userPickIntent(20)).toBe('list');
  });
});

describe('SupportView 类型（批3 同页切换，v2 决策2）', () => {
  it('SupportView 接受三态字面量（类型可赋值性；真切换逻辑在组件内，node 环境不可测）', () => {
    const s: SupportView = 'search';
    const u: SupportView = 'user';
    const o: SupportView = 'order';
    expect(s === 'search' && u === 'user' && o === 'order').toBe(true);
  });
});

describe('USER_ORDERS_PAGE_SIZE（v2 决策4：最近 10 单 + 加载更多）', () => {
  it('容量 = 10', () => {
    expect(USER_ORDERS_PAGE_SIZE).toBe(10);
  });
});

describe('visibleAddresses（地址簿折叠：默认前 3，其余收进显示更多）', () => {
  it('① ≤3 个全显，无折叠按钮', () => {
    const r = visibleAddresses(['a', 'b'], false);
    expect(r.items).toEqual(['a', 'b']);
    expect(r.hasMore).toBe(false);
    expect(r.hiddenCount).toBe(0);
  });
  it('② 0 个：空列表不渲染按钮', () => {
    const r = visibleAddresses([], false);
    expect(r.items).toEqual([]);
    expect(r.hasMore).toBe(false);
  });
  it('③ 5 个收起 → 前 3 + 隐藏 2（hasMore=true）', () => {
    const r = visibleAddresses(['a', 'b', 'c', 'd', 'e'], false);
    expect(r.items).toEqual(['a', 'b', 'c']);
    expect(r.hasMore).toBe(true);
    expect(r.hiddenCount).toBe(2);
  });
  it('④ 5 个展开 → 全显（hasMore 仍 true 供 toggle 判定）', () => {
    const r = visibleAddresses(['a', 'b', 'c', 'd', 'e'], true);
    expect(r.items).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.hasMore).toBe(true);
    expect(r.hiddenCount).toBe(0);
  });
  it('⑤ 地址使用追踪（20261018）：排序由后端决定，切片不改顺序（回归锁定——徽章判 lastUsedAt 非空渲染，不参与分节）', () => {
    // 后端新排序（lastUsedAt desc nulls last → isDefault → createdAt）产出此顺序：
    // 有 lastUsedAt 的在前（即使 isDefault=false），从未使用的旧地址排后
    const sortedFromBackend = [
      { id: 'a3', lastUsedAt: '2026-10-18T02:00:00Z', isDefault: false },
      { id: 'a1', lastUsedAt: null, isDefault: true },
      { id: 'a2', lastUsedAt: null, isDefault: false },
    ];
    const r = visibleAddresses(sortedFromBackend, false);
    expect(r.items.map((a) => a.id)).toEqual(['a3', 'a1', 'a2']);
    // 徽章判定口径：lastUsedAt 非空即「近期使用」，与 isDefault 无关
    const badgeTargets = r.items.filter((a) => a.lastUsedAt !== null);
    expect(badgeTargets.map((a) => a.id)).toEqual(['a3']);
  });
});

describe('批1 纯函数回归', () => {
  it('pickMatchedOrder 首条 / 空数组 null', () => {
    expect(pickMatchedOrder([1, 2])).toBe(1);
    expect(pickMatchedOrder<number>([])).toBe(null);
  });
  it('timelineState done/pending', () => {
    expect(timelineState('2026-10-18T00:00:00Z')).toBe('done');
    expect(timelineState(null)).toBe('pending');
  });
  it('shortRiderId 前 8 位', () => {
    expect(shortRiderId('0d9e4c85-2b9f-45d0-973a-7c0b94367d14')).toBe('0d9e4c85');
  });
  it('pickI18nText zh→en→首值→空串 fallback 链', () => {
    expect(pickI18nText({ zh: '好', en: 'good', pt: 'bom' })).toBe('好');
    expect(pickI18nText({ en: 'good' })).toBe('good');
    expect(pickI18nText({ pt: 'bom' })).toBe('bom');
    expect(pickI18nText({})).toBe('');
    expect(pickI18nText(null)).toBe('');
    expect(pickI18nText(undefined)).toBe('');
  });
});

// ===== 批1（工作台卡片增强 20261018）：support-cards 纯函数 =====
import {
  ALL_CARD_KEYS,
  visibleCardKeys,
  linkTargetForPerspective,
  SUPPORT_PIN_LABEL_KEY,
  countBadge,
  diliDayRangeIso,
  latestBadReviews,
  riderBottom3,
  riderTop3,
  sparklinePoints,
  loadPins,
  filterPinsForPerspective,
  defaultPins,
  addPin,
  removePin,
  DEFAULT_PIN_PATHS,
  PENDING_PROBE_LIMIT,
} from './support-cards';

describe('visibleCardKeys（批1 视角门控，v2 🔴1）', () => {
  it('platform 全六卡', () => {
    expect(visibleCardKeys('platform')).toEqual(ALL_CARD_KEYS);
  });
  it('support 仅 C2/C3/C6', () => {
    expect(visibleCardKeys('support')).toEqual(['c2', 'c3', 'c6']);
  });
  it('其余视角空数组（/support 不在 sidebar 范围）', () => {
    expect(visibleCardKeys('merchant')).toEqual([]);
    expect(visibleCardKeys('warehouse')).toEqual([]);
    expect(visibleCardKeys('rider-mgmt')).toEqual([]);
  });
});

describe('linkTargetForPerspective（批1 直达联动过滤）', () => {
  it('视角可达 → 原样返回（含 query）', () => {
    expect(linkTargetForPerspective('/refunds?status=PENDING', 'support')).toBe(
      '/refunds?status=PENDING',
    );
  });
  it('视角不可达 → null（不留死链：feedback/hot-search/statistics/dashboard 仅 platform）', () => {
    expect(linkTargetForPerspective('/feedback', 'support')).toBeNull();
    expect(linkTargetForPerspective('/hot-search', 'support')).toBeNull();
    expect(linkTargetForPerspective('/statistics', 'support')).toBeNull();
    expect(linkTargetForPerspective('/dashboard', 'support')).toBeNull();
  });
  it('platform 全可达', () => {
    for (const p of ['/dashboard', '/dispatch', '/feedback', '/hot-search', '/statistics']) {
      expect(linkTargetForPerspective(p, 'platform')).toBe(p);
    }
  });
  it('未知路径 → null', () => {
    expect(linkTargetForPerspective('/unknown', 'platform')).toBeNull();
  });
});

describe('countBadge（批1 C2 N+ 口径，v2 §三3）', () => {
  it('未达 limit 且无更多 → 精确数', () => {
    expect(countBadge(3, 5, false)).toEqual({ mode: 'exact', count: 3 });
  });
  it('取满 limit 且 hasMore → N+ 口径', () => {
    expect(countBadge(5, 5, true)).toEqual({ mode: 'plus', count: 5 });
  });
  it('取满 limit 但 hasMore=false（=全量恰好 limit）→ 精确数', () => {
    expect(countBadge(5, 5, false)).toEqual({ mode: 'exact', count: 5 });
  });
  it('探测条数为小值', () => {
    expect(PENDING_PROBE_LIMIT).toBeLessThanOrEqual(10);
  });
});

describe('diliDayRangeIso（批1 C2 今日新反馈窗口）', () => {
  it('东帝汶自然日 → UTC Z 形式（IsoTimestamp 不接受偏移量）', () => {
    // 2026-10-19T01:00:00Z = 东帝汶 10:00（同日）
    const { startDate, endDate } = diliDayRangeIso(new Date('2026-10-19T01:00:00Z'));
    expect(startDate).toBe('2026-10-18T15:00:00.000Z'); // Dili 00:00
    expect(endDate).toBe('2026-10-19T14:59:59.999Z'); // Dili 23:59:59.999
    expect(startDate.endsWith('Z')).toBe(true);
    expect(endDate.endsWith('Z')).toBe(true);
  });
  it('UTC 16:00 已跨东帝汶次日（UTC+9）', () => {
    // 2026-10-19T16:30:00Z = 东帝汶 2026-10-20 01:30
    const { startDate } = diliDayRangeIso(new Date('2026-10-19T16:30:00Z'));
    expect(startDate).toBe('2026-10-19T15:00:00.000Z');
  });
});

describe('latestBadReviews（批1 C3 差评合并）', () => {
  const mk = (id: string, rating: number, createdAt: string) => ({ id, rating, createdAt });
  it('两路合并按 createdAt 降序取 5', () => {
    const r1 = [mk('a', 1, '2026-10-01T00:00:00Z'), mk('b', 1, '2026-10-03T00:00:00Z')];
    const r2 = [mk('c', 2, '2026-10-02T00:00:00Z')];
    const out = latestBadReviews(r1, r2, 5);
    expect(out.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('超过 n 截断', () => {
    const r1 = ['1', '2', '3'].map((i) => mk(`a${i}`, 1, `2026-10-0${i}T00:00:00Z`));
    const r2 = ['1', '2', '3'].map((i) => mk(`b${i}`, 2, `2026-10-0${i}T12:00:00Z`));
    expect(latestBadReviews(r1, r2, 5)).toHaveLength(5);
  });
  it('空输入 → 空数组', () => {
    expect(latestBadReviews([], [], 5)).toEqual([]);
  });
});

describe('riderBottom3 / riderTop3（批1 C5 口径）', () => {
  const items = [
    { riderId: 'r1', riderName: 'A', rating: 4.8, completedOrders: 100 },
    { riderId: 'r2', riderName: 'B', rating: 3.2, completedOrders: 90 },
    { riderId: 'r3', riderName: 'C', rating: 4.1, completedOrders: 80 },
    { riderId: 'r4', riderName: 'D', rating: 2.9, completedOrders: 70 },
    { riderId: 'r5', riderName: 'E', rating: 3.5, completedOrders: 60 },
  ];
  it('TOP3 = 后端降序原序前 3（不另排序）', () => {
    expect(riderTop3(items).map((r) => r.riderId)).toEqual(['r1', 'r2', 'r3']);
  });
  it('BOTTOM3 = rating 升序取 3', () => {
    expect(riderBottom3(items).map((r) => r.riderId)).toEqual(['r4', 'r2', 'r5']);
  });
  it('rating 并列保持后端原序（稳定排序）', () => {
    const tied = [
      { riderId: 'x', riderName: 'X', rating: 3.0, completedOrders: 10 },
      { riderId: 'y', riderName: 'Y', rating: 3.0, completedOrders: 20 },
      { riderId: 'z', riderName: 'Z', rating: 3.0, completedOrders: 30 },
    ];
    expect(riderBottom3(tied).map((r) => r.riderId)).toEqual(['x', 'y', 'z']);
  });
  it('不足 3 人全取', () => {
    expect(riderBottom3(items.slice(0, 2))).toHaveLength(2);
  });
});

describe('sparklinePoints（批1 C1 内联 SVG）', () => {
  it('值域线性映射（最大值贴顶 y=0，最小值贴底 y=height）', () => {
    const pts = sparklinePoints([0, 10], 100, 20);
    expect(pts).toBe('0,20 100,0');
  });
  it('恒值居中', () => {
    const pts = sparklinePoints([5, 5, 5], 100, 20);
    expect(pts).toBe('0,10 50,10 100,10');
  });
  it('单点居中', () => {
    expect(sparklinePoints([7], 100, 20)).toBe('50,10');
  });
  it('空数组 → 空串', () => {
    expect(sparklinePoints([], 100, 20)).toBe('');
  });
});

describe('C6 钉选持久化（批1，localStorage admin_support_pins）', () => {
  it('loadPins: null → null（调用方回退默认）', () => {
    expect(loadPins(null)).toBeNull();
    expect(loadPins(undefined)).toBeNull();
  });
  it('loadPins: 坏 JSON → 空数组（回退链命中默认）', () => {
    expect(loadPins('{oops')).toEqual([]);
  });
  it('loadPins: 非数组 → 空数组', () => {
    expect(loadPins('{"a":1}')).toEqual([]);
  });
  it('loadPins: 未知路径逐项丢弃，合法路径保留', () => {
    expect(loadPins(JSON.stringify(['/refunds', '/hacker', 42, null]))).toEqual(['/refunds']);
  });
  it('filterPinsForPerspective: 去重保序 + 不可达剔除', () => {
    expect(filterPinsForPerspective(['/orders', '/orders', '/feedback'], 'support')).toEqual([
      '/orders',
    ]);
    expect(filterPinsForPerspective(['/orders', '/statistics'], 'platform')).toEqual([
      '/orders',
      '/statistics',
    ]);
  });
  it('defaultPins: platform 6 项全保留；support 收窄到可达项', () => {
    expect(defaultPins('platform')).toEqual(DEFAULT_PIN_PATHS);
    expect(defaultPins('support')).toEqual(['/orders', '/refunds', '/reviews']);
  });
  it('addPin 不重复 / removePin 移除', () => {
    const base = ['/orders', '/refunds'];
    expect(addPin(base, '/orders')).toEqual(base);
    expect(addPin(base, '/reviews')).toEqual(['/orders', '/refunds', '/reviews']);
    expect(removePin(base, '/refunds')).toEqual(['/orders']);
  });
  it('钉选池标签映射无未知路径（menu.* key 复用 sidebar 文案）', () => {
    for (const p of DEFAULT_PIN_PATHS) {
      expect(SUPPORT_PIN_LABEL_KEY[p]).toBeDefined();
    }
  });
});
