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
