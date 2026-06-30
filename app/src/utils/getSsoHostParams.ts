export interface SsoHostParams {
  app: string;
  port: string;
}

// Matches `.godaddy.com` plus any `.<prefix>-godaddy.com` (dev, test, stg, ote).
const GODADDY_ROOT_RE: RegExp = /\.([^.]*-)?godaddy\.com$/i;
const STANDARD_PORTS: ReadonlySet<string> = new Set(['', '80', '443', '3000']);

/**
 * Resolves the SSO `app` + `port` query-param values for the current host.
 * SSR-safe — returns the fallback app and empty port when window is undefined.
 */
export function getSsoHostParams(fallback: string = 'airo-builder'): SsoHostParams {
  if (typeof window === 'undefined') return { app: fallback, port: '' };
  const host: string = window.location.hostname.toLowerCase();
  const stripped: string = host.replace(GODADDY_ROOT_RE, '');
  const port: string = window.location.port;
  return {
    app: stripped && stripped !== host ? stripped : fallback,
    port: STANDARD_PORTS.has(port) ? '' : port,
  };
}
