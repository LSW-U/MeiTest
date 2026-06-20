/**
 * i18next 初始化（MeiMart client-app）
 *
 * 决策依据：CLAUDE.md §技术栈（App: RN + Expo + i18next）
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { resources, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../locales';

const deviceLocale = Localization.locale.split('-')[0].toLowerCase();
const initialLocale: SupportedLanguage = (
  SUPPORTED_LANGUAGES as readonly string[]
).includes(deviceLocale)
  ? (deviceLocale as SupportedLanguage)
  : 'en';

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export const changeLanguage = (lng: SupportedLanguage) => i18n.changeLanguage(lng);

export default i18n;
