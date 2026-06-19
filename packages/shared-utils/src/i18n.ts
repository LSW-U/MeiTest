/**
 * i18n 工具：语言检测 + Intl 格式化
 *
 * 决策依据：
 * - CLAUDE.md §多语言 + §全局约束 6
 * - 支持语言 en / id / zh / pt / tet（Tetum 留接口空翻译）
 * - fallback 链：lang → en → ""
 * - 时间/货币/数字格式用 Intl API，不要手写
 */

export const SUPPORTED_LANGUAGES = ['en', 'id', 'zh', 'pt', 'tet'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

const LANG_LOCALE: Record<SupportedLanguage, string> = {
  en: 'en-US',
  id: 'id-ID',
  zh: 'zh-CN',
  pt: 'pt-PT',
  tet: 'en-US', // Tetum 无专属 ICU locale，fallback en-US
};

/**
 * 从 Accept-Language header 解析首选语言（支持 q 值，匹配支持列表）
 * 例：detectLanguage('en;q=0.8,zh;q=0.9') → 'zh'
 */
export function detectLanguage(acceptLanguage: string | undefined | null): SupportedLanguage {
  if (!acceptLanguage) return DEFAULT_LANGUAGE;

  const entries = acceptLanguage
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [lang, ...params] = s.split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.split('=')[1]) : 1;
      return { lang: lang.toLowerCase().split('-')[0], q: Number.isNaN(q) ? 1 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of entries) {
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
      return lang as SupportedLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
}

/** 多语言字段取值（fallback 链 lang → en → ""） */
export function pickI18nField(
  field: Record<string, string> | null | undefined,
  lang: SupportedLanguage,
): string {
  if (!field) return '';
  return field[lang] ?? field.en ?? '';
}

/** 数字格式化（按语言） */
export function formatNumber(value: number, lang: SupportedLanguage = DEFAULT_LANGUAGE): string {
  return new Intl.NumberFormat(LANG_LOCALE[lang]).format(value);
}

/** 日期时间格式化（UTC+9 + 按语言 locale） */
export function formatDateTime(iso: string, lang: SupportedLanguage = DEFAULT_LANGUAGE): string {
  return new Intl.DateTimeFormat(LANG_LOCALE[lang], {
    timeZone: 'Asia/Dili',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
