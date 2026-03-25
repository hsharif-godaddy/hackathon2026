const I18N_API_URL =
  "https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-us/%40airo%2Fapp-builder";

let translations: Record<string, string> = {};
let loaded = false;

/**
 * Fetch translations from the GoDaddy i18n API.
 * Called once on dev-tools init; subsequent calls are no-ops.
 * Failures are silent — `t()` falls back to the provided default.
 */
export async function initTranslations(): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    const response = await fetch(I18N_API_URL);
    if (response.ok) {
      translations = await response.json();
    }
  } catch {
    // Silent fail — t() will use fallback strings
  }
}

/**
 * Translate a key, falling back to the provided default string.
 * Synchronous — uses translations loaded by `initTranslations()`.
 */
export function t(key: string, fallback: string): string {
  return translations[key] || fallback;
}
