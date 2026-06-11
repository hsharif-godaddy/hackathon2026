import { describe, expect, it } from 'vitest';

import { buildSsoLoginUrl, getSsoApp, getSsoHost } from '../sso-host';

const PROD_GODADDY = 'sso.godaddy.com';
const TEST_GODADDY = 'sso.test-godaddy.com';
const DEV_GODADDY = 'sso.dev-godaddy.com';
const PROD_GDCORP = 'sso.gdcorp.tools';
const TEST_GDCORP = 'sso.test-gdcorp.tools';
const DEV_GDCORP = 'sso.dev-gdcorp.tools';

describe('sso-host', () => {
    describe('getSsoHost', () => {
        // godaddy.com family
        it('routes prod godaddy.com subdomains to sso.godaddy.com', () => {
            expect(getSsoHost('console.godaddy.com')).toBe(PROD_GODADDY);
            expect(getSsoHost('debug.airo-builder.godaddy.com')).toBe(PROD_GODADDY);
        });

        it('routes the apex godaddy.com to sso.godaddy.com', () => {
            expect(getSsoHost('godaddy.com')).toBe(PROD_GODADDY);
        });

        it('routes test-godaddy.com subdomains to sso.test-godaddy.com', () => {
            expect(getSsoHost('console.test-godaddy.com')).toBe(TEST_GODADDY);
            expect(getSsoHost('airo-builder.test-godaddy.com')).toBe(TEST_GODADDY);
        });

        it('routes dev-godaddy.com subdomains to sso.dev-godaddy.com', () => {
            expect(getSsoHost('local.gasket.dev-godaddy.com')).toBe(DEV_GODADDY);
            expect(getSsoHost('local.gasket.dev-godaddy.com:8443')).toBe(DEV_GODADDY);
        });

        // gdcorp.tools family — paired with same-zone SSO so cookies round-trip.
        it('routes prod gdcorp.tools subdomains to sso.gdcorp.tools', () => {
            expect(getSsoHost('console.airo-builder.gdcorp.tools')).toBe(PROD_GDCORP);
            expect(getSsoHost('console.airo-builder.int.gdcorp.tools')).toBe(PROD_GDCORP);
            expect(getSsoHost('switchboard.int.gdcorp.tools')).toBe(PROD_GDCORP);
        });

        it('routes the apex gdcorp.tools to sso.gdcorp.tools', () => {
            expect(getSsoHost('gdcorp.tools')).toBe(PROD_GDCORP);
        });

        it('routes test-gdcorp.tools subdomains to sso.test-gdcorp.tools', () => {
            expect(getSsoHost('console.airo-builder.test-gdcorp.tools')).toBe(TEST_GDCORP);
            expect(getSsoHost('switchboard.int.test-gdcorp.tools')).toBe(TEST_GDCORP);
        });

        it('routes dev-gdcorp.tools subdomains to sso.dev-gdcorp.tools', () => {
            expect(getSsoHost('console.airo-builder.dev-gdcorp.tools')).toBe(DEV_GDCORP);
            expect(getSsoHost('local.console.airo-builder.dev-gdcorp.tools')).toBe(DEV_GDCORP);
            expect(getSsoHost('local.console.airo-builder.dev-gdcorp.tools:3443')).toBe(DEV_GDCORP);
        });

        it('does not treat lookalike gdcorp.tools suffixes as gdcorp.tools', () => {
            expect(getSsoHost('notgdcorp.tools')).toBe(TEST_GODADDY);
            expect(getSsoHost('evilgdcorp.tools')).toBe(TEST_GODADDY);
        });

        it('strips port before classification', () => {
            expect(getSsoHost('console.godaddy.com:443')).toBe(PROD_GODADDY);
            expect(getSsoHost('console.godaddy.com:8443')).toBe(PROD_GODADDY);
            expect(getSsoHost('console.test-godaddy.com:8443')).toBe(TEST_GODADDY);
            expect(getSsoHost('local.console.airo-builder.dev-gdcorp.tools:3443')).toBe(DEV_GDCORP);
        });

        it('is case-insensitive', () => {
            expect(getSsoHost('CONSOLE.GODADDY.COM')).toBe(PROD_GODADDY);
            expect(getSsoHost('Console.Test-Godaddy.com')).toBe(TEST_GODADDY);
            expect(getSsoHost('LOCAL.CONSOLE.AIRO-BUILDER.DEV-GDCORP.TOOLS')).toBe(DEV_GDCORP);
        });

        it('falls back to test-godaddy SSO for null / empty / unknown hosts', () => {
            expect(getSsoHost(null)).toBe(TEST_GODADDY);
            expect(getSsoHost(undefined)).toBe(TEST_GODADDY);
            expect(getSsoHost('')).toBe(TEST_GODADDY);
            expect(getSsoHost('localhost:3000')).toBe(TEST_GODADDY);
            expect(getSsoHost('evil.com')).toBe(TEST_GODADDY);
        });

        it('does not treat lookalike suffixes as godaddy.com', () => {
            expect(getSsoHost('notgodaddy.com')).toBe(TEST_GODADDY);
            expect(getSsoHost('evilgodaddy.com')).toBe(TEST_GODADDY);
        });
    });

    describe('getSsoApp', () => {
        // SSO templates the post-auth redirect as `<app>.<zone>/<path>`, so
        // returning host-minus-zone makes SSO round-trip back to the same host.
        it('strips the gdcorp.tools zone suffix to derive the app prefix', () => {
            expect(getSsoApp('console.airo-builder.gdcorp.tools')).toBe('console.airo-builder');
            expect(getSsoApp('console.airo-builder.dev-gdcorp.tools')).toBe('console.airo-builder');
            expect(getSsoApp('console.airo-builder.test-gdcorp.tools')).toBe('console.airo-builder');
        });

        it('strips the godaddy.com zone suffix to derive the app prefix', () => {
            expect(getSsoApp('console.airo-builder.godaddy.com')).toBe('console.airo-builder');
            expect(getSsoApp('console.airo-builder.test-godaddy.com')).toBe('console.airo-builder');
            expect(getSsoApp('console.airo-builder.dev-godaddy.com')).toBe('console.airo-builder');
        });

        it('preserves multi-segment app prefixes (e.g. local.* for /etc/hosts overrides)', () => {
            expect(getSsoApp('local.console.airo-builder.dev-gdcorp.tools')).toBe('local.console.airo-builder');
            expect(getSsoApp('local.console.airo-builder.dev-gdcorp.tools:3443')).toBe('local.console.airo-builder');
        });

        it('falls back to console.airo-builder for unknown / apex / lookalike hosts', () => {
            expect(getSsoApp(null)).toBe('console.airo-builder');
            expect(getSsoApp(undefined)).toBe('console.airo-builder');
            expect(getSsoApp('')).toBe('console.airo-builder');
            expect(getSsoApp('localhost:3000')).toBe('console.airo-builder');
            expect(getSsoApp('gdcorp.tools')).toBe('console.airo-builder');
        });

        it('is case-insensitive', () => {
            expect(getSsoApp('LOCAL.CONSOLE.AIRO-BUILDER.DEV-GDCORP.TOOLS')).toBe('local.console.airo-builder');
        });
    });

    describe('buildSsoLoginUrl', () => {
        it('produces the new-format URL for the local-dev gdcorp.tools host', () => {
            const url = new URL(buildSsoLoginUrl('local.console.airo-builder.dev-gdcorp.tools:3443', '/some/page'));
            expect(url.origin + url.pathname).toBe(`https://${DEV_GDCORP}/`);
            expect(url.searchParams.get('app')).toBe('local.console.airo-builder');
            expect(url.searchParams.get('realm')).toBe('jomax');
            expect(url.searchParams.get('referrer')).toBe('sso');
            expect(url.searchParams.get('port')).toBe('3443');
            expect(url.searchParams.get('path')).toBe('/some/page');
            // No `redirect` param — SSO templates the redirect from
            // `app` + the SSO instance's zone + `port` + `path`.
            expect(url.searchParams.get('redirect')).toBeNull();
        });

        it('uses the bare app prefix for the deployed prod gdcorp.tools host', () => {
            const url = new URL(buildSsoLoginUrl('console.airo-builder.gdcorp.tools'));
            expect(url.origin + url.pathname).toBe(`https://${PROD_GDCORP}/`);
            expect(url.searchParams.get('app')).toBe('console.airo-builder');
            expect(url.searchParams.get('port')).toBeNull();
        });

        it('defaults path to "/" when omitted (avoids "/None" Python None substitution)', () => {
            const url = new URL(buildSsoLoginUrl('local.console.airo-builder.dev-gdcorp.tools:3443'));
            expect(url.searchParams.get('path')).toBe('/');
        });

        it('routes prod godaddy.com hosts to sso.godaddy.com with the new format', () => {
            const url = new URL(buildSsoLoginUrl('console.airo-builder.godaddy.com'));
            expect(url.origin + url.pathname).toBe(`https://${PROD_GODADDY}/`);
            expect(url.searchParams.get('app')).toBe('console.airo-builder');
            expect(url.searchParams.get('realm')).toBe('jomax');
            expect(url.searchParams.get('referrer')).toBe('sso');
        });

        it('preserves search and hash in the path argument', () => {
            const url = new URL(buildSsoLoginUrl(
                'local.console.airo-builder.dev-gdcorp.tools:3443',
                '/apps/123?tab=logs#timeline',
            ));
            expect(url.searchParams.get('path')).toBe('/apps/123?tab=logs#timeline');
        });
    });
});
