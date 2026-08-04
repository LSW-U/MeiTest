-- P2-1 POC seed：灌 1 万条假商品，5 语言 name
-- 设计：10 个真实商品短词（中文 2-3 字 + 英/印尼/葡/德顿对应），每词灌 1000 条
-- 每条 name 加数字后缀模拟长尾（"苹果 1" ~ "苹果 1000"），验证 ILIKE '%苹果%' 匹配 1000 条
DROP TABLE IF EXISTS word_pool;
CREATE TABLE word_pool (zh text, en text, id text, pt text, tet text);
INSERT INTO word_pool VALUES
  ('苹果',   'Apple',           'Apel',          'Maçã',          'Apple'),
  ('牛奶',   'Milk',            'Susu',          'Leite',         'Susu'),
  ('饼干',   'Biscuit',         'Biskuit',       'Bolacha',       'Biskuit'),
  ('巧克力', 'Chocolate',       'Cokelat',       'Chocolate',     'Cokelat'),
  ('方便面', 'Instant Noodles', 'Mie Instan',    'Lámen',         'Mie Instan'),
  ('矿泉水', 'Mineral Water',   'Air Mineral',   'Água Mineral',  'Bebida'),
  ('面包',   'Bread',           'Roti',          'Pão',           'Paun'),
  ('鸡蛋',   'Egg',             'Telur',         'Ovo',           'Toos'),
  ('大米',   'Rice',            'Beras',         'Arroz',         'Hare'),
  ('食用油', 'Cooking Oil',     'Minyak Goreng', 'Óleo de Cozinha','Minyak');

INSERT INTO products (id, name)
SELECT
  format('prod-%s-%s', wp.en, gs)::text,
  jsonb_build_object(
    'zh',  wp.zh  || ' ' || gs::text,
    'en',  wp.en  || ' ' || gs::text,
    'id',  wp.id  || ' ' || gs::text,
    'pt',  wp.pt  || ' ' || gs::text,
    'tet', wp.tet || ' ' || gs::text
  )
FROM generate_series(1, 1000) gs
CROSS JOIN word_pool wp;

ANALYZE products;

SELECT '总商品数：' || count(*)::text FROM products;
SELECT '含「苹果」(zh) 商品数：' || count(*)::text FROM products WHERE name->>'zh' ILIKE '%苹果%';
SELECT '含「牛奶」(zh) 商品数：' || count(*)::text FROM products WHERE name->>'zh' ILIKE '%牛奶%';
SELECT '含「milk」(en) 商品数：' || count(*)::text FROM products WHERE name->>'en' ILIKE '%milk%';
