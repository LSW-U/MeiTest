import en from './en.json';
import zh from './zh.json';
import id from './id.json';
import pt from './pt.json';

export const resources = { en, zh, id, pt } as const;
export const SUPPORTED_LANGUAGES = ['en', 'zh', 'id', 'pt'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
