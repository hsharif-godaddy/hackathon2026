let translations: Record<string, string> = {};

/**
 * Receive translations from parent window via postMessage.
 * Called by DEVTOOLS_TRANSLATIONS message handler in DevelopmentMode.
 * This is the only mechanism for loading translations - parent app provides them.
 */
export function setTranslations(translationData: Record<string, string>): void {
  translations = { ...translations, ...translationData };
}

/**
 * Translate a key, falling back to the provided default string.
 * Translations are provided by the parent app via setTranslations().
 * If no translation exists, returns the fallback value.
 */
export function t(key: string, fallback: string): string {
  return translations[key] || fallback;
}
