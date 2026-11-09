/**
 * 批量查询 categoryId -> { 多语言分类名, 冷链标识 } map（P3批2 P1-1 拆出为 shared helper）
 *
 * 消费方：catalog.service（列表/详情/推荐/admin 列表组装链）+ user.service（favorites
 * ProductSummary 必填 isColdChain）。同口径单点查询，避免跨模块复制逻辑（同
 * getCategoryTop3ProductIds / deriveNearExpiry 先例）。
 *
 * P3批2：查询带出 coldChain（零额外查询），组装链据此派生 isColdChain（D2b 单点）。
 * B11：解决前端拿 categoryId(uuid) 无法显示分类名的问题。categorySlug 未补（Category 表
 * 无 slug 字段，加需 migration+回填；B6 已提供真实 SKU 端点绕过 variantTemplates 按 slug 匹配）。
 */
import type { Tx } from './transaction';

export interface CategoryInfo {
  name: Record<string, string>;
  coldChain: boolean;
}

export async function batchGetCategoryInfo(
  db: Tx,
  categoryIds: (string | null)[],
): Promise<Map<string, CategoryInfo>> {
  const validIds = [...new Set(categoryIds.filter((id): id is string => id !== null))];
  if (validIds.length === 0) return new Map();
  const cats = await db.category.findMany({
    where: { id: { in: validIds } },
    select: { id: true, name: true, coldChain: true },
  });
  const map = new Map<string, CategoryInfo>();
  for (const c of cats)
    map.set(c.id, { name: c.name as Record<string, string>, coldChain: c.coldChain });
  return map;
}
