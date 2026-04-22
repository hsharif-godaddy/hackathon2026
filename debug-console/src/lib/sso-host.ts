/**
 * Isomorphic helpers for selecting the right SSO host. Safe to import from
 * both server routes and client components.
 *
 * Keep this logic in one place — previously the server used a rootDomain check
 * while the client used a hostname substring check, and the two disagreed on
 * `*.dev-godaddy.com` (server routed to test, client fell through to prod).
 */
const PROD_SSO_HOST = 'sso.godaddy.com';
const TEST_SSO_HOST = 'sso.test-godaddy.com';

export function getSsoHost(fqdn: string | null | undefined): string {
    const host = (fqdn || '').split(':')[0].toLowerCase();
    const isGodaddyFqdn = host === 'godaddy.com' || host.endsWith('.godaddy.com');
    const isTestVariant = host.endsWith('.test-godaddy.com') || host.endsWith('.dev-godaddy.com');
    return isGodaddyFqdn && !isTestVariant ? PROD_SSO_HOST : TEST_SSO_HOST;
}

export function buildSsoLoginUrl(returnUrl: string, fqdn: string): string {
    const envLoginUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL;
    const baseUrl = envLoginUrl || `https://${getSsoHost(fqdn)}/login`;

    const params = new URLSearchParams({
        app: 'console.airo-builder',
        redirect: returnUrl,
        realm: 'jomax'
    });

    return `${baseUrl}?${params.toString()}`;
}
