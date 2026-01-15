/**
 * i18n Configuration
 *
 * Configure supported languages and default language here.
 * Add or remove languages as needed for your site.
 */

export interface Language {
  /** ISO 639-1 language code (e.g., 'en', 'es', 'fr') */
  code: string;
  /** Display name in that language (e.g., 'English', 'Español') */
  name: string;
  /** Text direction: 'ltr' (left-to-right) or 'rtl' (right-to-left) */
  dir: 'ltr' | 'rtl';
}

/**
 * List of supported languages
 * The first language is used as the fallback
 */
export const supportedLanguages: Language[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  // Add more languages as needed:
  // { code: 'fr', name: 'Français', dir: 'ltr' },
  // { code: 'de', name: 'Deutsch', dir: 'ltr' },
  // { code: 'ar', name: 'العربية', dir: 'rtl' },
];

/**
 * Default/fallback language code
 */
export const defaultLanguage = 'en';

/**
 * Get language codes as array (for i18n config)
 */
export const languageCodes = supportedLanguages.map((lang) => lang.code);

/**
 * Check if a language code is supported
 */
export function isLanguageSupported(code: string): boolean {
  return languageCodes.includes(code);
}

/**
 * Get language details by code
 */
export function getLanguage(code: string): Language | undefined {
  return supportedLanguages.find((lang) => lang.code === code);
}
