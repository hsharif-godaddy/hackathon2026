/**
 * Pair each FQDN zone with its same-zone SSO instance so the auth_jomax
 * cookie comes back to the requesting host.
 */
const PROD_SSO_GODADDY = 'sso.godaddy.com';
const TEST_SSO_GODADDY = 'sso.test-godaddy.com';
const DEV_SSO_GODADDY = 'sso.dev-godaddy.com';
const PROD_SSO_GDCORP = 'sso.gdcorp.tools';
const TEST_SSO_GDCORP = 'sso.test-gdcorp.tools';
const DEV_SSO_GDCORP = 'sso.dev-gdcorp.tools';

export function getSsoHost(fqdn: string | null | undefined): string {
    const host = (fqdn || '').split(':')[0].toLowerCase();

    // gdcorp.tools family (internal-tools convention)
    if (host.endsWith('.dev-gdcorp.tools')) return DEV_SSO_GDCORP;
    if (host.endsWith('.test-gdcorp.tools')) return TEST_SSO_GDCORP;
    if (host === 'gdcorp.tools' || host.endsWith('.gdcorp.tools')) return PROD_SSO_GDCORP;

    // godaddy.com family (legacy/customer-zone)
    if (host.endsWith('.dev-godaddy.com')) return DEV_SSO_GODADDY;
    if (host.endsWith('.test-godaddy.com')) return TEST_SSO_GODADDY;
    if (host === 'godaddy.com' || host.endsWith('.godaddy.com')) return PROD_SSO_GODADDY;

    // Unknown / localhost / lookalike domains — bias to test-godaddy (least-
    // privilege fallback that won't accidentally accept a prod-SSO-signed JWT).
    return TEST_SSO_GODADDY;
}

// Longest first so `.dev-gdcorp.tools` matches before `.gdcorp.tools` would.
const SSO_ZONE_SUFFIXES = [
    '.dev-gdcorp.tools',
    '.test-gdcorp.tools',
    '.gdcorp.tools',
    '.dev-godaddy.com',
    '.test-godaddy.com',
    '.godaddy.com',
] as const;

const DEFAULT_SSO_APP = 'console.airo-builder';

/**
 * Derive the SSO `app=` parameter from the request host. SSO templates the
 * post-auth redirect as `<app>.<sso-zone>/<path>`, so returning host-minus-zone
 * makes SSO round-trip back to the same host the request came from.
 */
export function getSsoApp(fqdn: string | null | undefined): string {
    const host = (fqdn || '').split(':')[0].toLowerCase();
    for (const suffix of SSO_ZONE_SUFFIXES) {
        if (host.endsWith(suffix)) {
            return host.slice(0, -suffix.length);
        }
    }
    return DEFAULT_SSO_APP;
}

function extractPort(fqdn: string | null | undefined): string {
    const parts = (fqdn || '').split(':');
    return parts.length > 1 ? parts[1] : '';
}

/**
 * Build the SSO login URL.
 *
 * `host` must include port if non-default — pass `window.location.host`, not
 * `.hostname`. `path` defaults to `/`; pass `pathname + search + hash` to
 * preserve deep-links. Omitting `path` makes SSO substitute Python's `None`
 * and land the user on `<host>/None`.
 */
export function buildSsoLoginUrl(host: string, path: string = '/'): string {
    const ssoHost = getSsoHost(host);
    const port = extractPort(host);

    const params = new URLSearchParams({
        app: getSsoApp(host),
        realm: 'jomax',
        referrer: 'sso',
        path,
    });
    if (port) params.set('port', port);

    return `https://${ssoHost}/?${params.toString()}`;
}
