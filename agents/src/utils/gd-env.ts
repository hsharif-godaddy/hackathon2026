export type GdEnv = 'dev' | 'test' | 'prod';

/**
 * Resolve GoDaddy environment from GODADDY_API_BASE_URL.
 * Sniffs the URL for dev-godaddy / test-godaddy substrings;
 * defaults to 'prod' when neither matches (or the var is unset).
 */
export function resolveEnv(): GdEnv {
  const apiUrl = process.env.GODADDY_API_BASE_URL || '';
  if (apiUrl.includes('dev-godaddy.com')) return 'dev';
  if (apiUrl.includes('test-godaddy.com')) return 'test';
  return 'prod';
}
