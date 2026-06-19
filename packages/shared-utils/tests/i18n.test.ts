import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  detectLanguage,
  pickI18nField,
  formatNumber,
  formatDateTime,
} from '../src/i18n';

describe('i18n', () => {
  it('SUPPORTED_LANGUAGES 含 en/id/zh/pt/tet', () => {
    expect(SUPPORTED_LANGUAGES).toContain('en');
    expect(SUPPORTED_LANGUAGES).toContain('id');
    expect(SUPPORTED_LANGUAGES).toContain('zh');
    expect(SUPPORTED_LANGUAGES).toContain('pt');
    expect(SUPPORTED_LANGUAGES).toContain('tet');
  });

  it('DEFAULT_LANGUAGE = en', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('detectLanguage: undefined/null/空 → 默认 en', () => {
    expect(detectLanguage(undefined)).toBe('en');
    expect(detectLanguage(null)).toBe('en');
    expect(detectLanguage('')).toBe('en');
  });

  it('detectLanguage: 精确匹配', () => {
    expect(detectLanguage('zh')).toBe('zh');
    expect(detectLanguage('id')).toBe('id');
    expect(detectLanguage('pt')).toBe('pt');
    expect(detectLanguage('en')).toBe('en');
  });

  it('detectLanguage: 区域变体降级（zh-CN → zh, en-US → en）', () => {
    expect(detectLanguage('zh-CN')).toBe('zh');
    expect(detectLanguage('en-US')).toBe('en');
    expect(detectLanguage('pt-BR')).toBe('pt');
  });

  it('detectLanguage: q 值排序', () => {
    expect(detectLanguage('en;q=0.8,zh;q=0.9')).toBe('zh');
    expect(detectLanguage('en;q=0.9,zh;q=0.8')).toBe('en');
  });

  it('detectLanguage: 不支持的语言 → fallback en', () => {
    expect(detectLanguage('fr')).toBe('en');
    expect(detectLanguage('de,fr;q=0.8')).toBe('en');
  });

  it('detectLanguage: 无效 q 值（非数字）→ 当作 1', () => {
    expect(detectLanguage('zh;q=abc')).toBe('zh');
  });

  it('pickI18nField: 精确匹配', () => {
    const field = { en: 'Milk', zh: '牛奶', id: 'Susu' };
    expect(pickI18nField(field, 'zh')).toBe('牛奶');
    expect(pickI18nField(field, 'id')).toBe('Susu');
  });

  it('pickI18nField: 缺失语言 → en fallback', () => {
    const field = { en: 'Milk', id: 'Susu' };
    expect(pickI18nField(field, 'zh')).toBe('Milk');
    expect(pickI18nField(field, 'pt')).toBe('Milk');
  });

  it('pickI18nField: 全部缺失 → 空字符串', () => {
    expect(pickI18nField(null, 'zh')).toBe('');
    expect(pickI18nField(undefined, 'zh')).toBe('');
    expect(pickI18nField({}, 'zh')).toBe('');
  });

  it('formatNumber: en', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
  });

  it('formatNumber: 默认语言 en', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('formatDateTime: 返回字符串', () => {
    const s = formatDateTime('2026-06-20T00:00:00.000Z', 'en');
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
