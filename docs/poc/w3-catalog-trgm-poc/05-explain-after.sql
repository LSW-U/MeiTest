-- P2-1 POC：建索引后 EXPLAIN ANALYZE
-- 预期：5 语言 OR → BitmapOr + 5× BitmapIndexScan；单语言 → Bitmap Index Scan
-- go/no-go 判定：中文 2-3 字词（B/C）走 BitmapIndexScan 即 GO

\echo '--- A. 5 语言 OR（catalog 实际查询形状，预期 BitmapOr + 5× BitmapIndexScan）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products
WHERE name->>'en' ILIKE '%milk%'
   OR name->>'zh' ILIKE '%苹果%'
   OR name->>'id' ILIKE '%apel%'
   OR name->>'pt' ILIKE '%maçã%'
   OR name->>'tet' ILIKE '%apple%';

\echo ''
\echo '--- B. 中文 2 字短词「苹果」单语言（go/no-go 关键）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%苹果%';

\echo ''
\echo '--- C. 中文 3 字短词「巧克力」单语言 ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%巧克力%';

\echo ''
\echo '--- D. 中文单字「苹」（trigram 退化，预期仍 seq scan — 可接受边界）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%苹%';

\echo ''
\echo '--- E. 英文短词「milk」单语言（基线对照）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'en' ILIKE '%milk%';

\echo ''
\echo '--- F. 5 语言 OR 罕见词（0 匹配，验证低匹配率下规划器选 BitmapOr）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products
WHERE name->>'en' ILIKE '%zzz_nonexistent_xyz%'
   OR name->>'zh' ILIKE '%不存在的词xyz%'
   OR name->>'id' ILIKE '%zzz_nonexistent_xyz%'
   OR name->>'pt' ILIKE '%zzz_nonexistent_xyz%'
   OR name->>'tet' ILIKE '%zzz_nonexistent_xyz%';

\echo ''
\echo '--- G. 中文 2 字「苹果 5」长尾（~1.1% 匹配率，模拟真实搜索）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%苹果 5%';

\echo ''
\echo '--- H. 5 语言 OR 中等匹配（搜「苹果」仅 zh 命中，其他语言 0，~10%）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products
WHERE name->>'en' ILIKE '%zzz_nonexistent_xyz%'
   OR name->>'zh' ILIKE '%苹果%'
   OR name->>'id' ILIKE '%zzz_nonexistent_xyz%'
   OR name->>'pt' ILIKE '%zzz_nonexistent_xyz%'
   OR name->>'tet' ILIKE '%zzz_nonexistent_xyz%';
