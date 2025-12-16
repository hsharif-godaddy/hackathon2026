/**
 * Translations module exports
 * 
 * Central export point for all translation utilities in the application.
 * Provides both client-side and server-side translation functions.
 */

// Shared translation loading utility (direct API call - no HTTP)
export { loadTranslations } from './load-translations';

// client-side translation fetching (via HTTP API route)
export { fetchTranslationPackages } from './fetch-translations';

// Server-side translation utility
export { clearServerIntlCache, detectLocale, getServerIntl, getTranslationMessages, type ServerIntlOptions } from './server-intl';

