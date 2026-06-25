const PROD_HOSTS = new Set(['airo.ai', 'airo-builder.godaddy.com']);

function normalizeHost(host: string): string {
  if (host.startsWith('[')) {
    const closeIdx = host.indexOf(']');
    return closeIdx > 0 ? host.slice(1, closeIdx) : host;
  }
  return host.split(':')[0] ?? host;
}

/**
 * True when the app is served from a production BFF host (airo.ai / legacy prod host).
 * Used to gate Switchboard flags that should always be on in dev/test/local.
 */
export function isProductionAppHost(host?: string): boolean {
  const rawHost = host ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  if (rawHost) {
    return PROD_HOSTS.has(normalizeHost(rawHost));
  }

  if (typeof window === 'undefined') {
    return process.env.ENVIRONMENT_NAME === 'production';
  }

  return false;
}
