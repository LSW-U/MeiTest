/**
 * 分类 Top3 批量标记 helper 测试（商品详情整合 批D P2-1，2026-09-08）
 *
 * getCategoryTop3ProductIds：列表类接口（/client/products、search、recommendations、favorites）
 * 批量算 isCategoryTop3 用——一次查询覆盖全部分类，口径与批B 单商品版 isCategoryTop3 一致
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tx } from '../src/shared/db/transaction';
import { getCategoryTop3ProductIds } from '../src/shared/db/category-top3';

function makeDb() {
  return { product: { findMany: vi.fn() } };
}

describe('getCategoryTop3ProductIds（批D P2-1 列表 Top3 批量标记）', () => {
  let fakeDb: ReturnType<typeof makeDb>;
  beforeEach(() => {
    fakeDb = makeDb();
  });

  it('多分类各自裁前 3（行序即排名序，超出的丢弃）', async () => {
    // DB 已按 salesCount desc + id asc 返回：cat-A 4 行（取前 3），cat-B 2 行（全取）
    fakeDb.product.findMany.mockResolvedValueOnce([
      { id: 'a1', categoryId: 'cat-A' },
      { id: 'b1', categoryId: 'cat-B' },
      { id: 'a2', categoryId: 'cat-A' },
      { id: 'b2', categoryId: 'cat-B' },
      { id: 'a3', categoryId: 'cat-A' },
      { id: 'a4', categoryId: 'cat-A' }, // 第 4 名，裁掉
    ]);
    const set = await getCategoryTop3ProductIds(fakeDb as unknown as Tx, [
      { id: 'x1', categoryId: 'cat-A' },
      { id: 'x2', categoryId: 'cat-B' },
    ]);
    expect([...set].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    // 口径锁定：ACTIVE + salesCount desc + id asc 兜并列（与批B 单商品版一致）
    expect(fakeDb.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { categoryId: { in: ['cat-A', 'cat-B'] }, status: 'ACTIVE' },
        orderBy: [{ salesCount: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('一次查询覆盖全部分类（非逐商品 N+1）', async () => {
    fakeDb.product.findMany.mockResolvedValueOnce([]);
    await getCategoryTop3ProductIds(fakeDb as unknown as Tx, [
      { id: 'p1', categoryId: 'cat-1' },
      { id: 'p2', categoryId: 'cat-2' },
      { id: 'p3', categoryId: 'cat-3' },
    ]);
    expect(fakeDb.product.findMany).toHaveBeenCalledTimes(1);
  });

  it('空输入不查库，返回空集合', async () => {
    const set = await getCategoryTop3ProductIds(fakeDb as unknown as Tx, []);
    expect(set.size).toBe(0);
    expect(fakeDb.product.findMany).not.toHaveBeenCalled();
  });

  it('全部商品无分类不查库，恒 false（与批B 单商品版口径一致）', async () => {
    const set = await getCategoryTop3ProductIds(fakeDb as unknown as Tx, [
      { id: 'p1', categoryId: null },
      { id: 'p2', categoryId: null },
    ]);
    expect(set.size).toBe(0);
    expect(fakeDb.product.findMany).not.toHaveBeenCalled();
  });

  it('同分类去重（列表多商品同分类，where in 不重复）', async () => {
    fakeDb.product.findMany.mockResolvedValueOnce([{ id: 'p1', categoryId: 'cat-1' }]);
    const set = await getCategoryTop3ProductIds(fakeDb as unknown as Tx, [
      { id: 'p1', categoryId: 'cat-1' },
      { id: 'p2', categoryId: 'cat-1' },
      { id: 'p3', categoryId: 'cat-1' },
    ]);
    expect(set.has('p1')).toBe(true);
    expect(fakeDb.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoryId: { in: ['cat-1'] }, status: 'ACTIVE' } }),
    );
  });
});
