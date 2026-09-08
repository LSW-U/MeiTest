/**
 * 分类 Top3 商品 id 集合（商品详情整合 批D P2-1，2026-09-08）
 *
 * 列表类接口（/client/products、search、recommendations、favorites）批量标记
 * isCategoryTop3 用：一次查询覆盖全部相关分类，避免逐商品 N+1。
 *
 * 判定口径与 catalog.service isCategoryTop3（批B 详情端点单商品版）完全一致，两处必须同步改：
 *   - 只看 ACTIVE 商品（吃 @@index([status, salesCount])）
 *   - orderBy salesCount desc + id asc 兜并列销量稳定排序（第 3/4 名同分时 id 小者入选）
 *   - 每分类取前 3；商品无分类 / 自身非 ACTIVE → 恒不在集合（false）
 *
 * 💭 已知规模点：findMany 拉全部相关分类的 ACTIVE 行内存裁前 3（非窗口函数），
 *   MVP 几十商品量级无感；量级上来后可换 ROW_NUMBER() OVER (PARTITION BY category_id)。
 */
import type { Tx } from './transaction';

export async function getCategoryTop3ProductIds(
  db: Tx,
  products: Array<{ id: string; categoryId: string | null }>,
): Promise<Set<string>> {
  const categoryIds = [
    ...new Set(products.map((p) => p.categoryId).filter((c): c is string => c != null)),
  ];
  if (categoryIds.length === 0) return new Set();

  const rows = await db.product.findMany({
    where: { categoryId: { in: categoryIds }, status: 'ACTIVE' },
    orderBy: [{ salesCount: 'desc' }, { id: 'asc' }],
    select: { id: true, categoryId: true },
  });

  // 行序即排名序（DB 已按 salesCount desc + id asc 排好），按分类计数裁前 3
  const top3 = new Set<string>();
  const picked = new Map<string, number>();
  for (const row of rows) {
    const categoryId = row.categoryId;
    if (categoryId == null) continue; // where 已过滤非空，防御式收窄（select 结果类型仍带 null）
    const n = picked.get(categoryId) ?? 0;
    if (n >= 3) continue;
    picked.set(categoryId, n + 1);
    top3.add(row.id);
  }
  return top3;
}
