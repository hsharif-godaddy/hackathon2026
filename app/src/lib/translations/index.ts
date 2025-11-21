/**
 * Translations module exports
 * 
 * Central export point for all translation utilities in the application.
 * Provides both client-side and server-side translation functions.
 */

// Shared translation fetching utility
export { fetchTranslationPackages } from './fetch-translations';

// Server-side translation utility
export { getServerIntl, clearServerIntlCache, detectLocale, type ServerIntlOptions } from './server-intl';

