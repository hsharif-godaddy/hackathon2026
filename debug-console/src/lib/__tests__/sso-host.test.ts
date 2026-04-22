import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSsoLoginUrl, getSsoHost } from '../sso-host';

const PROD = 'sso.godaddy.com';
const TEST = 'sso.test-godaddy.com';

describe('sso-host', () => {
    describe('getSsoHost', () => {
        it('routes prod godaddy.com subdomains to PROD_SSO_HOST', () => {
            expect(getSsoHost('console.godaddy.com')).toBe(PROD);
            expect(getSsoHost('debug.airo-builder.godaddy.com')).toBe(PROD);
        });

        it('routes the apex godaddy.com to PROD_SSO_HOST', () => {
            expect(getSsoHost('godaddy.com')).toBe(PROD);
        });

        it('routes test-godaddy.com subdomains to TEST_SSO_HOST', () => {
            expect(getSsoHost('console.test-godaddy.com')).toBe(TEST);
            expect(getSsoHost('airo-builder.test-godaddy.com')).toBe(TEST);
        });

        it('routes dev-godaddy.com subdomains to TEST_SSO_HOST', () => {
            expect(getSsoHost('local.gasket.dev-godaddy.com')).toBe(TEST);
        });

        it('strips port before classification (regression for prod hosts on non-default ports)', () => {
            expect(getSsoHost('console.godaddy.com:443')).toBe(PROD);
            expect(getSsoHost('console.godaddy.com:8443')).toBe(PROD);
            expect(getSsoHost('console.test-godaddy.com:8443')).toBe(TEST);
        });

        it('is case-insensitive', () => {
            expect(getSsoHost('CONSOLE.GODADDY.COM')).toBe(PROD);
            expect(getSsoHost('Console.Test-Godaddy.com')).toBe(TEST);
        });

        it('falls back to TEST_SSO_HOST for null / empty / unknown hosts', () => {
            expect(getSsoHost(null)).toBe(TEST);
            expect(getSsoHost(undefined)).toBe(TEST);
            expect(getSsoHost('')).toBe(TEST);
            expect(getSsoHost('localhost:3000')).toBe(TEST);
            expect(getSsoHost('evil.com')).toBe(TEST);
        });

        it('does not treat lookalike suffixes as godaddy.com', () => {
            // Guards against `endsWith('godaddy.com')` style mistakes — a
            // hostname like `notgodaddy.com` must not route to prod SSO.
            expect(getSsoHost('notgodaddy.com')).toBe(TEST);
            expect(getSsoHost('evilgodaddy.com')).toBe(TEST);
        });
    });

    describe('buildSsoLoginUrl', () => {
        const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SSO_LOGIN_URL;

        beforeEach(() => {
            delete process.env.NEXT_PUBLIC_SSO_LOGIN_URL;
        });

        afterEach(() => {
            if (ORIGINAL_ENV === undefined) {
                delete process.env.NEXT_PUBLIC_SSO_LOGIN_URL;
            } else {
                process.env.NEXT_PUBLIC_SSO_LOGIN_URL = ORIGINAL_ENV;
            }
        });

        it('uses the prod SSO host for prod fqdn and includes required params', () => {
            const url = new URL(buildSsoLoginUrl('https://console.godaddy.com/dashboard', 'console.godaddy.com'));
            expect(url.origin + url.pathname).toBe(`https://${PROD}/login`);
            expect(url.searchParams.get('app')).toBe('console.airo-builder');
            expect(url.searchParams.get('realm')).toBe('jomax');
            expect(url.searchParams.get('redirect')).toBe('https://console.godaddy.com/dashboard');
        });

        it('uses the test SSO host for dev fqdn', () => {
            const url = new URL(buildSsoLoginUrl('https://local.gasket.dev-godaddy.com:8443/', 'local.gasket.dev-godaddy.com:8443'));
            expect(url.origin + url.pathname).toBe(`https://${TEST}/login`);
        });

        it('honors NEXT_PUBLIC_SSO_LOGIN_URL when set', () => {
            process.env.NEXT_PUBLIC_SSO_LOGIN_URL = 'https://custom.sso.example.com/auth/login';
            const url = new URL(buildSsoLoginUrl('https://console.godaddy.com/', 'console.godaddy.com'));
            expect(url.origin + url.pathname).toBe('https://custom.sso.example.com/auth/login');
            expect(url.searchParams.get('app')).toBe('console.airo-builder');
            expect(url.searchParams.get('realm')).toBe('jomax');
        });
    });
});
