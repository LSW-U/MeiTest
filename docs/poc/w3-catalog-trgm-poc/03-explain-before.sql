-- P2-1 POC：建索引前 EXPLAIN ANALYZE
-- 模拟 catalog.service.ts:85-92 的 5 语言 OR raw ILIKE
-- 预期：SeqScan（无 trgm/gin 索引）

\echo '--- A. 5 语言 OR（catalog 实际查询形状）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products
WHERE name->>'en' ILIKE '%milk%'
   OR name->>'zh' ILIKE '%苹果%'
   OR name->>'id' ILIKE '%apel%'
   OR name->>'pt' ILIKE '%maçã%'
   OR name->>'tet' ILIKE '%apple%';

\echo ''
\echo '--- B. 中文 2 字短词「苹果」单语言（重点：trigram 选择性）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%苹果%';

\echo ''
\echo '--- C. 中文 3 字短词「巧克力」单语言 ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%巧克力%';

\echo ''
\echo '--- D. 中文单字「苹」（trigram 对单字退化，预期 seq scan）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'zh' ILIKE '%苹%';

\echo ''
\echo '--- E. 英文短词「milk」单语言（基线对照）---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id FROM products WHERE name->>'en' ILIKE '%milk%';
