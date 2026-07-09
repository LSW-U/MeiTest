-- MeiMart 商品 name 字段修复脚本（W7-fix 2026-07-09）
--
-- 问题：导入脚本把英文描述塞到了 name 的 4 个语言字段，导致：
--   1. name 是长描述而非简短商品名
--   2. 4 语言值完全相同，i18n 切换无效果
--
-- 修复策略：
--   1. 从 main_image URL 文件名提取简短英文商品名
--      例：apple-thumb.webp -> "Apple"
--          calvin-klein-ck-one-eau-de-thumb.webp -> "Calvin Klein Ck One"
--   2. name 4 语言都设为英文简短名（暂无翻译，未来补 zh/id/pt）
--   3. description 字段保留原值（已经是英文描述，正确）
--   4. unit 字段不动（已正确）
--
-- 安全：
--   1. 执行前已备份到 products_name_backup_20260709（id, name, description）
--   2. 可回滚：UPDATE products p SET name = b.name FROM products_name_backup_20260709 b WHERE p.id = b.id;

-- 验证：修复前 name 是长描述
SELECT id, name->'en' as name_before FROM products LIMIT 3;

-- 修复：从 main_image URL 提取简短英文商品名
UPDATE products
SET name = jsonb_build_object(
  'en',
  initcap(
    replace(
      replace(
        replace(
          split_part(
            replace(main_image, '-thumb.webp', ''),
            '/',
            -1
          ),
          '-eau-de', ''
        ),
        '-with-mirror', ''
      ),
      '-', ' '
    )
  )
)
WHERE name->'en' IS NOT NULL;

-- 验证：修复后 name 是简短商品名
SELECT id, name->'en' as name_after FROM products LIMIT 5;

-- 后续待办（人工/LLM 翻译）：
--   UPDATE products SET name = jsonb_set(name, '{zh}', '"苹果"'::jsonb) WHERE name->>'en' = 'Apple';
--   ... 40 条逐条翻译
