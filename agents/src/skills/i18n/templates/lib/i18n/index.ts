/**
 * i18n Initialization
 *
 * This file initializes react-i18next with the configured languages.
 * Import this file once at the app entry point (main.tsx) before rendering.
 *
 * AGENT: Add translation imports and resources for each language below.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import { defaultLanguage, languageCodes } from './config';

// AGENT: Import translation files for each language
// import en from '../../locales/en.json';
// import es from '../../locales/es.json';

/**
 * Translation resources - one file per language
 * AGENT: Populate with imported translation files
 */
const resources = {
  // en: { translation: en },
  // es: { translation: es },
};

i18n
  // Detect user language from browser/localStorage
  .use(LanguageDetector)
  // Connect to React
  .use(initReactI18next)
  // Initialize
  .init({
    resources,
    fallbackLng: defaultLanguage,
    supportedLngs: languageCodes,

    // Default namespace (single file per language)
    defaultNS: 'translation',
    ns: ['translation'],

    // Language detection options
    detection: {
      // Order of detection methods
      order: ['localStorage', 'navigator', 'htmlTag'],
      // Cache user language preference
      caches: ['localStorage'],
      // LocalStorage key
      lookupLocalStorage: 'i18nextLng',
    },

    interpolation: {
      // React already escapes values
      escapeValue: false,
    },

    // Don't load missing translations from backend
    saveMissing: false,

    // Development: warn about missing keys
    debug: import.meta.env.DEV,
  });

export default i18n;
