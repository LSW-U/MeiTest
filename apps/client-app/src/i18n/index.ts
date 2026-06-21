/**
 * i18next 初始化（MeiMart client-app）
 *
 * 决策依据：CLAUDE.md §技术栈（App: RN + Expo + i18next）
 * 翻译源：@meimart/shared-locales（与 admin-web / rider-app 共享）
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { messages, SUPPORTED_LOCALES, type Locale } from '@meimart/shared-locales';

const deviceLocale = Localization.locale.split('-')[0].toLowerCase();
const initialLocale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(deviceLocale)
  ? (deviceLocale as Locale)
  : 'en';

void i18n.use(initReactI18next).init({
  resources: messages as unknown as import('i18next').Resource,
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export const changeLanguage = (lng: Locale) => i18n.changeLanguage(lng);

export default i18n;
