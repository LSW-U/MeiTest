/**
 * 应用 40 商品的多语言翻译到 seed-data.json
 *
 * 用法：
 *   node apps/api/prisma/seed-images/apply-translations.mjs
 *
 * 做的事：
 *   1. 读 seed-data.json
 *   2. 给每个商品加 `name` 字段（5 语言简短商品名，从 TITLE_TRANSLATIONS 取）
 *   3. 修 `description` 的 zh/id/pt/tet（原本都是英文）
 *   4. 修 `unit` 的 id/pt/tet（原本都是 "pack"）
 *   5. 写回 seed-data.json（pretty print）
 *   6. 输出 scripts/update-product-translations.sql（DB 直接 update 用）
 *
 * 一对一映射 key = seed-data.json 的 title 字段（英文）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DATA_PATH = join(__dirname, 'seed-data.json');
const SQL_OUTPUT_PATH = join(__dirname, '../../../..', 'scripts', 'update-product-translations.sql');

/**
 * 40 商品 × 3 字段（name + description + unit）× 5 语言（en/id/zh/pt/tet）
 * key = title（seed-data.json 里的 title 字段，英文）
 *
 * name: 简短商品名（< 30 字符）
 * description: 1-2 句商品描述
 * unit: 销售单位（pack / bottle / kg 等）
 * tet: 德顿语（Tetum）人工翻译，2026-10-03 批1 五语化；先例风格参照 seed-client-foods.ts 商品级 tet
 */
const TRANSLATIONS = {
  // ===== Groceries (27) =====
  Apple: {
    name: { zh: '苹果', id: 'Apel', pt: 'Maçã', tet: 'Maçã' },
    description: {
      zh: '新鲜脆甜的苹果，适合零食或各种烹饪。',
      id: 'Apel segar dan renyah, cocok untuk camilan atau memasak.',
      pt: 'Maçãs frescas e crocantes, perfeitas para lanches ou culinária.',
      tet: 'Maçã fresu no meten, diak ba hahan sira ka farkude iha kozina.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Beef Steak': {
    name: { zh: '牛排', id: 'Bistik', pt: 'Bife', tet: 'Bisti Baka' },
    description: {
      zh: '优质牛排，适合煎烤至您喜欢的熟度。',
      id: 'Bistik berkualitas, cocok untuk dipanggang atau dimasak sesuai selera.',
      pt: 'Bife de qualidade, ótimo para grelhar ou cozinhar no ponto desejado.',
      tet: 'Bisti baka kualidade diak, diak ba suli ka nanoi tuir ita hakarak.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Cat Food': {
    name: { zh: '猫粮', id: 'Makanan Kucing', pt: 'Comida para Gato', tet: 'Hahan Busa' },
    description: {
      zh: '营养猫粮，满足猫咪日常饮食需求。',
      id: 'Makanan kucing bergizi untuk memenuhi kebutuhan gizi harian kucing.',
      pt: 'Comida para gato nutritiva, formulada para necessidades dietéticas diárias.',
      tet: 'Hahan busa nutrisaun diak, atu preenxe presiza hahan busa lor-loron.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Chicken Meat': {
    name: { zh: '鸡肉', id: 'Daging Ayam', pt: 'Frango', tet: 'Naan Manu' },
    description: {
      zh: '新鲜嫩鸡肉，适合各种烹饪方式。',
      id: 'Daging ayam segar dan empuk, cocok untuk berbagai masakan.',
      pt: 'Frango fresco e macio, adequado para várias receitas culinárias.',
      tet: 'Naan manu fresu no mamuk, diak ba kozina oioin.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Cooking Oil': {
    name: { zh: '食用油', id: 'Minyak Goreng', pt: 'Óleo de Cozinha', tet: 'Minan Tahan' },
    description: {
      zh: '通用食用油，适合煎炒各种料理。',
      id: 'Minyak goreng serbaguna untuk menggoreng, menumis, dan memasak.',
      pt: 'Óleo de cozinha versátil, adequado para fritar, refogar e cozinhar.',
      tet: "Minan tahan serbaguna, diak ba nana'i ka kozina hahan oioin.",
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },
  Cucumber: {
    name: { zh: '黄瓜', id: 'Mentimun', pt: 'Pepino', tet: 'Pepinu' },
    description: {
      zh: '清脆多汁的黄瓜，适合沙拉、零食或料理。',
      id: 'Mentimun segar dan renyah, ideal untuk salad atau camilan.',
      pt: 'Pepinos crocantes e hidratantes, ideais para saladas ou lanches.',
      tet: 'Pepinu fresu no besik, diak ba salada ka hahan.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Dog Food': {
    name: { zh: '狗粮', id: 'Makanan Anjing', pt: 'Comida para Cão', tet: 'Hahan Asu' },
    description: {
      zh: '专为狗狗设计的营养狗粮，提供必需营养。',
      id: 'Makanan anjing khusus untuk memberikan nutrisi penting.',
      pt: 'Comida para cão formulada para fornecer nutrição essencial.',
      tet: 'Hahan asu espesial ho nutrisaun importante ba asu.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  Eggs: {
    name: { zh: '鸡蛋', id: 'Telur', pt: 'Ovos', tet: 'Manu Tolun' },
    description: {
      zh: '新鲜鸡蛋，烘焙、烹饪或早餐的百搭食材。',
      id: 'Telur segar, bahan serbaguna untuk memanggang dan memasak.',
      pt: 'Ovos frescos, ingrediente versátil para culinária e padaria.',
      tet: 'Manu tolun fresu, diak ba nanoi, kozina ka kafe daan.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  'Fish Steak': {
    name: { zh: '鱼排', id: 'Ikan Fillet', pt: 'Bife de Peixe', tet: 'Bisti Ikan' },
    description: {
      zh: '优质鱼排，适合煎、烤或烘烤。',
      id: 'Ikan fillet berkualitas, cocok untuk dipanggang atau digoreng.',
      pt: 'Bife de peixe de qualidade, ideal para grelhar ou assar.',
      tet: 'Bisti ikan kualidade diak, diak ba suli ka nanoi.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Green Bell Pepper': {
    name: { zh: '青椒', id: 'Paprika Hijau', pt: 'Pimentão Verde', tet: 'Pimenton Mean' },
    description: {
      zh: '新鲜青椒，为菜肴增色增味。',
      id: 'Paprika hijau segar, sempurna untuk menambah warna dan rasa.',
      pt: 'Pimentão verde fresco, perfeito para adicionar cor e sabor.',
      tet: 'Pimenton mean fresu, hamosu kor no rasa iha hahan.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Green Chili Pepper': {
    name: { zh: '青辣椒', id: 'Cabai Hijau', pt: 'Pimenta Verde', tet: 'Aé Mean' },
    description: {
      zh: '辛辣青辣椒，为菜肴加热度。',
      id: 'Cabai hijau pedas, ideal untuk menambah rasa pedas.',
      pt: 'Pimenta verde picante, ideal para dar calor aos pratos.',
      tet: 'Aé mean mak hera, diak ba hamosu rasa hera iha hahan.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Honey Jar': {
    name: { zh: '蜂蜜罐', id: 'Toples Madu', pt: 'Pote de Mel', tet: 'Fuan-Fuan' },
    description: {
      zh: '纯天然蜂蜜，方便罐装，适合甜味或烹饪。',
      id: 'Madu murni alami dalam toples, cocok untuk pemanis.',
      pt: 'Mel puro e natural em pote prático, perfeito para adoçar.',
      tet: 'Fuan-fuan naturál diak iha kaxa, diak ba hamosu rasa midar.',
    },
    unit: { zh: '罐', id: 'toples', pt: 'pote', tet: 'toples' },
  },
  'Ice Cream': {
    name: { zh: '冰淇淋', id: 'Es Krim', pt: 'Gelado', tet: 'Ais Krim' },
    description: {
      zh: '香滑可口的冰淇淋，多种口味可选。',
      id: 'Es krim lembut dan lezat dengan berbagai rasa.',
      pt: 'Gelado cremoso e delicioso, disponível em vários sabores.',
      tet: 'Ais krim mamar no gosta, iha rasa oioin atu hili.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  Juice: {
    name: { zh: '果汁', id: 'Jus', pt: 'Sumo', tet: 'Sumu' },
    description: {
      zh: '清爽果汁，富含维生素，适合随时饮用。',
      id: 'Jus buah segar, kaya vitamin, cocok untuk segarkan dahaga.',
      pt: 'Sumo de fruta refrescante, rico em vitaminas.',
      tet: 'Sumu ai-han fresu, ho vitamina barak, diak bedik.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  Kiwi: {
    name: { zh: '猕猴桃', id: 'Kiwi', pt: 'Kiwi', tet: 'Kiwi' },
    description: {
      zh: '营养丰富的猕猴桃，适合零食或热带风味。',
      id: 'Kiwi kaya nutrisi, cocok untuk camilan atau tambahan rasa tropis.',
      pt: 'Kiwi rico em nutrientes, perfeito para lanches.',
      tet: 'Kiwi ho nutrisaun barak, diak ba hahan ka kozina tropikal.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  Lemon: {
    name: { zh: '柠檬', id: 'Lemon', pt: 'Limão', tet: 'Lemu' },
    description: {
      zh: '酸爽柠檬，适合烹饪、烘焙或制作饮品。',
      id: 'Lemon segar dan asam, serbaguna untuk memasak atau minuman.',
      pt: 'Limões zestosos, versáteis para culinária ou bebidas.',
      tet: 'Lemu fresu no asam, diak ba kozina ka hamosu bedik.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  Milk: {
    name: { zh: '牛奶', id: 'Susu', pt: 'Leite', tet: 'Susu' },
    description: {
      zh: '新鲜营养牛奶，多种食谱的常备食材。',
      id: 'Susu segar dan bergizi, bahan utama untuk berbagai resep.',
      pt: 'Leite fresco e nutritivo, essencial para várias receitas.',
      tet: 'Susu fresu ho nutrisaun, hahan importante ba kozina oioin.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },
  Mulberry: {
    name: { zh: '桑葚', id: 'Murbai', pt: 'Amora', tet: 'Amora' },
    description: {
      zh: '甜美多汁的桑葚，适合零食或烘焙。',
      id: 'Murbai manis dan segar, cocok untuk camilan atau tambahan hidangan.',
      pt: 'Amoras doces e suculentas, ótimas para lanches.',
      tet: 'Amora midar no fresu, diak ba hahan ka sobremesa.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Nescafe Coffee': {
    name: { zh: '雀巢咖啡', id: 'Kopi Nescafe', pt: 'Café Nescafe', tet: 'Kafe Neskafe' },
    description: {
      zh: '雀巢优质咖啡，多种烘焙度可选。',
      id: 'Kopi Nescafe berkualitas dengan berbagai varian roasting.',
      pt: 'Café Nescafe de qualidade, disponível em várias misturas.',
      tet: 'Kafe Neskafe kualidade diak, iha roasting oioin atu hili.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },
  Potatoes: {
    name: { zh: '土豆', id: 'Kentang', pt: 'Batatas', tet: 'Batata' },
    description: {
      zh: '多用途土豆，适合烤、煮、捣泥等多种烹饪。',
      id: 'Kentang serbaguna, cocok untuk dipanggang, direbus, atau dihaluskan.',
      pt: 'Batatas versáteis, ótimas para assar, cozer ou puré.',
      tet: 'Batata serbaguna, diak ba suli, tee ka halo puré.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  'Protein Powder': {
    name: { zh: '蛋白粉', id: 'Bubuk Protein', pt: 'Pó de Proteína', tet: 'Fuin Proteina' },
    description: {
      zh: '富含营养的蛋白粉，适合补充日常蛋白质需求。',
      id: 'Bubuk protein bergizi, ideal untuk melengkapi kebutuhan protein harian.',
      pt: 'Pó de proteína nutritivo, ideal para suplementação.',
      tet: 'Fuin proteina ho nutrisaun barak, diak ba proteina lor-loron.',
    },
    unit: { zh: '罐', id: 'toples', pt: 'pote', tet: 'toples' },
  },
  'Red Onions': {
    name: { zh: '红葱头', id: 'Bawang Merah', pt: 'Cebolas Vermelhas', tet: 'Luan Mean' },
    description: {
      zh: '风味红葱头，为料理增添层次与香气。',
      id: 'Bawang merah beraroma, menambah kedalaman rasa pada masakan.',
      pt: 'Cebolas vermelhas aromáticas, perfeitas para dar sabor.',
      tet: 'Luan mean ho aroma diak, hamosu rasa manas iha kozina.',
    },
    unit: { zh: '包', id: 'pak', pt: 'pacote', tet: 'pakote' },
  },
  Rice: {
    name: { zh: '大米', id: 'Beras', pt: 'Arroz', tet: 'Holas' },
    description: {
      zh: '优质大米，多种料理的主食之选。',
      id: 'Beras berkualitas, makanan pokok untuk berbagai masakan.',
      pt: 'Arroz de qualidade, alimento básico para várias cozinhas.',
      tet: 'Holas kualidade diak, hahan boot ba kozina oioin.',
    },
    unit: { zh: '袋', id: 'karung', pt: 'saco', tet: 'saku' },
  },
  'Soft Drinks': {
    name: { zh: '软饮料', id: 'Minuman Ringan', pt: 'Refrigerantes', tet: 'Bedik Faris' },
    description: {
      zh: '各种口味软饮料，适合清凉解渴。',
      id: 'Minuman ringan dengan berbagai rasa, cocok untuk menyegarkan.',
      pt: 'Refrigerantes em vários sabores, perfeitos para refrescar.',
      tet: "Bedik faris ho rasa oioin, diak ba hasa'e luan.",
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },
  Strawberry: {
    name: { zh: '草莓', id: 'Stroberi', pt: 'Morango', tet: 'Mora' },
    description: {
      zh: '甜美多汁的草莓，适合零食、甜点或烘焙。',
      id: 'Stroberi manis dan segar, cocok untuk camilan atau hidangan penutup.',
      pt: 'Morangos doces e suculentos, ótimos para sobremesas.',
      tet: 'Mora midar no fresu, diak ba hahan ka sobremesa.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  'Tissue Paper Box': {
    name: { zh: '纸巾盒', id: 'Kotak Tisu', pt: 'Caixa de Lenços', tet: 'Surat Tisu' },
    description: {
      zh: '方便纸巾盒，柔软纸巾，日常使用。',
      id: 'Kotak tisu praktis dengan tisu lembut untuk penggunaan harian.',
      pt: 'Caixa de lenços prática, com lenços suaves para uso diário.',
      tet: 'Surat tisu prakatiku, tisu mamuk ba uza lor-loron.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  Water: {
    name: { zh: '矿泉水', id: 'Air Mineral', pt: 'Água Mineral', tet: 'Bee Móin' },
    description: {
      zh: '纯净矿泉水，保持水分补充的必需品。',
      id: 'Air mineral murni, penting untuk menjaga hidrasi tubuh.',
      pt: 'Água mineral pura, essencial para manter-se hidratado.',
      tet: 'Bee móin moos, importante atu horon naran lor-loron.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },

  // ===== Beauty (5) =====
  'Essence Mascara Lash Princess': {
    name: { zh: '睫毛膏', id: 'Maskara', pt: 'Máscara para Cílios', tet: 'Maskara' },
    description: {
      zh: 'Essence 睫毛膏，能打造浓密纤长的睫毛效果。',
      id: 'Maskara Essence yang populer untuk bulu mata tebal dan panjang.',
      pt: 'Máscara Essence popular para cílios volumosos e alongados.',
      tet: 'Maskara Essence populár ba bulu mata boot no naruk.',
    },
    unit: { zh: '支', id: 'batang', pt: 'tubo', tet: 'tubo' },
  },
  'Eyeshadow Palette with Mirror': {
    name: { zh: '眼影盘（带镜）', id: 'Palette Bayangan dengan Cermin', pt: 'Paleta de Sombras com Espelho', tet: 'Paleta Ain-Matin' },
    description: {
      zh: '带镜眼影盘，多种颜色可选，适合日常或精致妆容。',
      id: 'Palette bayangan dengan cermin, beragam warna untuk makeup harian.',
      pt: 'Paleta de sombras com espelho, variadas cores para looks diários.',
      tet: 'Paleta ain-matin ho kor oioin, diak ba dekorasaun lor-loron.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  'Powder Canister': {
    name: { zh: '粉饼盒', id: 'Pact', pt: 'Pó Compacto', tet: 'Fuin Powdér' },
    description: {
      zh: '细腻定妆粉饼，控油持久，便携装。',
      id: 'Pact halus untuk menahan minyak dan tahan lama, ukuran travel.',
      pt: 'Pó compacto fino, controla oleosidade e dura muito tempo.',
      tet: 'Fuin powdér fino atu tama dekorasaun no taka ramen.',
    },
    unit: { zh: '盒', id: 'kotak', pt: 'caixa', tet: 'kaxa' },
  },
  'Red Lipstick': {
    name: { zh: '红色口红', id: 'Lipstik Merah', pt: 'Batom Vermelho', tet: 'Lipstik Mean' },
    description: {
      zh: '经典红色口红，为唇部增添亮丽色彩。',
      id: 'Lipstik merah klasik untuk tampilan bibir yang menonjol.',
      pt: 'Batom vermelho clássico e ousado para lábios vibrantes.',
      tet: 'Lipstik mean klásiku, hamosu kor nakar ba bibin.',
    },
    unit: { zh: '支', id: 'batang', pt: 'tubo', tet: 'tubo' },
  },
  'Red Nail Polish': {
    name: { zh: '红色指甲油', id: 'Cat Kuku Merah', pt: 'Esmalte Vermelho', tet: 'Farós Mean' },
    description: {
      zh: '浓郁光泽的红色指甲油，色彩持久鲜艳。',
      id: 'Cat kuku merah dengan kilau kaya dan warna tahan lama.',
      pt: 'Esmalte vermelho com brilho rico e cor duradoura.',
      tet: 'Farós mean ho kilat boot, kor toma lorak.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'frasco', tet: 'fasu' },
  },

  // ===== Skin Care (3) =====
  'Attitude Super Leaves Hand Soap': {
    name: { zh: 'Attitude 护手洗手液', id: 'Sabun Tangan Attitude Super Leaves', pt: 'Sabão de Mãos Attitude Super Leaves', tet: 'Sabun Attitude' },
    description: {
      zh: 'Attitude 天然温和洗手液，滋养不干燥。',
      id: 'Sabun tangan Attitude yang alami dan melembutkan tangan.',
      pt: 'Sabão de mãos Attitude natural e nutritivo.',
      tet: 'Sabun fon naturál Attitude, mamar no nutre liman.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },
  'Olay Ultra Moisture Shea Butter Body Wash': {
    name: { zh: 'Olay 滋养身体沐浴露', id: 'Sabun Mandi Olay Ultra Moisture', pt: 'Gel de Banho Olay Ultra Moisture', tet: 'Sabun-Fon Olay' },
    description: {
      zh: 'Olay 含乳木果油的奢华滋润沐浴露，深层保湿。',
      id: 'Sabun mandi Olay dengan shea butter untuk melembapkan kulit.',
      pt: 'Gel de banho Olay com manteiga de karité para hidratação profunda.',
      tet: 'Sabun-fon Olay ho manteiga karité, mamar kulit kleur.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },
  'Vaseline Men Body and Face Lotion': {
    name: { zh: '凡士林男士面身乳', id: 'Losion Vaseline Men', pt: 'Loção Vaseline Men', tet: 'Losion Vaseline' },
    description: {
      zh: '凡士林男士专用面身乳，专为男性肌肤调配。',
      id: 'Losion Vaseline Men khusus untuk wajah dan tubuh pria.',
      pt: 'Loção Vaseline Men formulada para pelefa do rosto e corpo masculino.',
      tet: 'Losion Vaseline ba mane, ba ain no oan mane nian.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'garrafa', tet: 'fasu' },
  },

  // ===== Fragrances (5) =====
  'Calvin Klein CK One': {
    name: { zh: 'CK One 香水', id: 'Parfum CK One', pt: 'Perfume CK One', tet: 'Parfum CK One' },
    description: {
      zh: 'Calvin Klein CK One 经典中性香水，清新柑橘调。',
      id: 'Parfum unisex klasik CK One dengan aroma segar citrus.',
      pt: 'Perfume unisex clássico CK One, aroma cítrico fresco.',
      tet: 'Parfum CK One klásiku unisex, aroma sítirus fresu.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'frasco', tet: 'fasu' },
  },
  'Chanel Coco Noir Eau De': {
    name: { zh: '香奈儿 Coco Noir', id: 'Coco Noir Chanel', pt: 'Coco Noir Chanel', tet: 'Parfum Coco Noir' },
    description: {
      zh: 'Chanel Coco Noir 优雅神秘香水，深邃东方调。',
      id: 'Parfum Coco Noir Chanel yang elegan dan misterius.',
      pt: 'Perfume Coco Noir Chanel, elegante e misterioso.',
      tet: 'Parfum Coco Noir Chanel, eleganti no mistériozu.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'frasco', tet: 'fasu' },
  },
  "Dior J'adore": {
    name: { zh: '迪奥真我香水', id: "Parfum J'adore Dior", pt: "Perfume J'adore Dior", tet: "Parfum J'adore Dior" },
    description: {
      zh: 'Dior J\'adore 奢华花香调香水，优雅女性气质。',
      id: "Parfum J'adore Dior dengan aroma floral mewah.",
      pt: "Perfume J'adore Dior, floral luxuoso e elegante.",
      tet: "Parfum J'adore Dior, floral luxuozu no eleganti.",
    },
    unit: { zh: '瓶', id: 'botol', pt: 'frasco', tet: 'fasu' },
  },
  'Dolce Shine Eau de': {
    name: { zh: '杜嘉班纳 Shine', id: 'Dolce Shine D&G', pt: 'Dolce Shine D&G', tet: 'Parfum Dolce Shine' },
    description: {
      zh: 'D&G Dolce Shine 鲜活果香调香水，明亮活泼。',
      id: 'Parfum Dolce Shine D&G dengan aroma buah segar dan cerah.',
      pt: 'Perfume Dolce Shine D&G, aroma frutado vibrante.',
      tet: 'Parfum Dolce Shine D&G, aroma fruta mateus no naruk.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'frasco', tet: 'fasu' },
  },
  'Gucci Bloom Eau de': {
    name: { zh: '古驰绽放', id: 'Gucci Bloom', pt: 'Gucci Bloom', tet: 'Parfum Gucci Bloom' },
    description: {
      zh: 'Gucci Bloom 花香调香水，捕捉绽放之美。',
      id: 'Parfum Gucci Bloom dengan aroma floral yang memikat.',
      pt: 'Perfume Gucci Bloom, floral e cativante.',
      tet: 'Parfum Gucci Bloom, floral no faín, aroma modernu.',
    },
    unit: { zh: '瓶', id: 'botol', pt: 'frasco', tet: 'fasu' },
  },
};

// ===== 主流程 =====
const seedData = JSON.parse(readFileSync(SEED_DATA_PATH, 'utf-8'));
console.log(`📖 读取 ${seedData.length} 个商品`);

let missingTitles = [];
let sqlStatements = [];

for (const p of seedData) {
  const t = TRANSLATIONS[p.title];
  if (!t) {
    missingTitles.push(p.title);
    continue;
  }
  // 1. 加 name 字段（5 语言）
  p.name = {
    en: p.title,
    zh: t.name.zh,
    id: t.name.id,
    pt: t.name.pt,
    tet: t.name.tet,
  };
  // 2. 修 description（原本 4 语言都是英文）
  p.description.zh = t.description.zh;
  p.description.id = t.description.id;
  p.description.pt = t.description.pt;
  p.description.tet = t.description.tet;
  // 3. 修 unit（原本 id/pt 都是 "pack"）
  p.unit.zh = t.unit.zh;
  p.unit.id = t.unit.id;
  p.unit.pt = t.unit.pt;
  p.unit.tet = t.unit.tet;

  // 4. 生成 SQL update（按 main_image 唯一定位）
  const mainImage = p.mainImage.replace(/'/g, "''");
  const nameJson = JSON.stringify(p.name).replace(/'/g, "''");
  const descJson = JSON.stringify(p.description).replace(/'/g, "''");
  const unitJson = JSON.stringify(p.unit).replace(/'/g, "''");
  sqlStatements.push(
    `UPDATE products SET name = '${nameJson}'::jsonb, description = '${descJson}'::jsonb, unit = '${unitJson}'::jsonb WHERE main_image = '${mainImage}';`,
  );
}

if (missingTitles.length > 0) {
  console.error('❌ 缺少翻译的 title:', missingTitles);
  process.exit(1);
}

// 写回 seed-data.json（pretty print）
writeFileSync(SEED_DATA_PATH, JSON.stringify(seedData, null, 2) + '\n', 'utf-8');
console.log(`✅ 写回 ${seedData.length} 个商品到 seed-data.json`);

// 写 SQL update 文件
const sqlContent = [
  '-- MeiMart 商品多语言字段修复 SQL（auto-generated by apply-translations.mjs）',
  '-- 时间：2026-07-09 初版 4 语言；2026-10-03 批1 重跑补 tet 五语化',
  '-- 用途：直接 update DB 的 name/description/unit 字段为正确 5 语言翻译（en/id/zh/pt/tet）',
  '-- 安全：可回滚 - 备份在 products_name_backup_20260709',
  '-- 回滚：UPDATE products p SET name=b.name, description=b.description, unit=b.unit FROM products_name_backup_20260709 b WHERE p.id=b.id;',
  '',
  'BEGIN;',
  '',
  ...sqlStatements,
  '',
  'COMMIT;',
  '',
  '-- 验证：',
  "-- SELECT name->'en' as en, name->'tet' as tet FROM products WHERE main_image LIKE '%apple%';",
  '',
].join('\n');
writeFileSync(SQL_OUTPUT_PATH, sqlContent, 'utf-8');
console.log(`✅ 输出 SQL: ${SQL_OUTPUT_PATH}`);
console.log(`   ${sqlStatements.length} 条 UPDATE 语句`);
