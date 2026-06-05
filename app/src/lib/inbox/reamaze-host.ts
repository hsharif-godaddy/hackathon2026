/**
 * Shared Reamaze host resolution for BFF endpoints
 */

export function getReamazeHost(): string {
  const environmentName = process.env.ENVIRONMENT_NAME || '';
  if (environmentName === 'production') return 'reamaze.godaddy.com';
  if (environmentName === 'test') return 'reamaze.test-godaddy.com';
  return 'reamaze.dev-godaddy.com';
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
