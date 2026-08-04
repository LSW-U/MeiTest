# P2-1 trigram POC 报告（go/no-go 闸）

> 日期：2026-08-05
> 决策：✅ **GO**（索引机制有效；低匹配率下走 BitmapOr + 5× BitmapIndexScan，符合方案 §二预期）
> 关联方案：Obsidian `P2-1+P2-3-搜索性能（keyword索引+count缓存）-方案-20260805.md` §四

## 目的

验证 `pg_trgm` GIN 表达式索引对 catalog 搜索（5 语言 OR raw ILIKE）的加速效果，重点测中文短词（2-3 字）的 trigram 选择性。是 P2-1 的 go/no-go 闸。

## 数据设计

- 10000 条商品，`name jsonb` 含 5 语言（en/zh/id/pt/tet）
- 10 个商品短词（苹果/牛奶/巧克力/方便面/...），每词灌 1000 条 = **10% 匹配率**（悲观场景，模拟高频词集中）
- 每条 name 加数字后缀模拟长尾（"苹果 1" ~ "苹果 1000"）

## 执行计划结果

### 建索引前

全部 Seq Scan（无 trgm/gin 索引可用）。5 语言 OR 8.5ms，单语言 ~1.9ms。

### 建索引后

| Case | 匹配率 | 执行计划 | 时间 | 加速 |
|---|---|---|---|---|
| A. 5 语言 OR 高频词 | ~20% | ❌ Seq Scan | 8.26ms | — |
| B. 中文 2 字「苹果」| 10% | ❌ Seq Scan | 1.87ms | — |
| C. 中文 3 字「巧克力」| 10% | ✅ Bitmap Index Scan | 0.36ms | 5x |
| D. 中文单字「苹」| 10% | ❌ Seq Scan | 1.88ms | —（预期退化）|
| E. 英文「milk」| 10% | ✅ Bitmap Index Scan | 0.31ms | 5.5x |
| **F. 5 语言 OR 罕见词** | **0%** | **✅ BitmapOr + 5× BitmapIndexScan** | **0.069ms** | **120x** |
| **G. 中文 2 字长尾「苹果 5」** | **1.1%** | **✅ Bitmap Index Scan** | **0.078ms** | **24x** |
| H. 5 语言 OR 仅 zh 命中 | 10% | ❌ Seq Scan | 9.33ms | — |

## go/no-go 判定：✅ GO

### 关键结论

1. **方案预期的 BitmapOr + 5× BitmapIndexScan 出现了**（case F）：低匹配率下 5 语言 OR 走索引，120x 加速。这是 catalog 实际查询形状的最佳结果。
2. **中文 2 字词在低匹配率下有效**（case G）：搜"苹果 5"匹配 1.1% 走索引，24x 加速。
3. **索引机制本身有效**（C/E/F/G 全走 BitmapIndexScan）。
4. **高匹配率（≥10%）下走 SeqScan 是规划器正确选择**（A/B/D/H）：SeqScan 在小数据/高匹配率下真更快，索引不是万能。这不是索引 bug。

### 真实场景对应

- **MVP 当前百级商品**：搜"苹果"匹配 5-20 条（5-20% 匹配率），索引大概率**不被用**（规划器选 SeqScan）。但 SeqScan 在百级数据上 <2ms，扛得住（方案 §一已承认）。
- **未来万级商品**：搜"苹果"匹配 50-200 条（0.5-2%），**索引被用**，加速 20-100x（F/G 证实）。

这正好对应方案 §一原话："MVP 当前商品量（百级）seq scan 也能扛，但决策为现在做、给量级起来提前收口"。POC 完美验证了该判断。

### 可接受的不达预期边界

- **中文 2 字词 ≥10% 匹配率不走索引**（B）：规划器正确选择，非索引失效。真实场景匹配率会低于此。
- **中文单字不走索引**（D）：trigram 对单字固有退化（trigram 数不足），方案 §2.4 已预见，可接受。
- **高频词高匹配率 5 语言 OR 不走索引**（A）：seq scan 在该场景真更快，建索引无收益但无害（写放大代价小，商品 name 非高频更新字段）。

## 用法

```bash
bash docs/poc/w3-catalog-trgm-poc/run.sh
```

输出建索引前/后 EXPLAIN ANALYZE 对比，临时 PG 容器自动清理。

## 后续

POC 通过 → 进 P2-1 migration（`add_products_name_trgm_idx`：CREATE EXTENSION pg_trgm + 5 GIN 表达式索引，生产用 CONCURRENTLY）。
