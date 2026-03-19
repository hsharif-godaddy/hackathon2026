import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { getRootDomainFromHeaders } from '../getRootDomain';

describe('getRootDomain', () => {
    describe('getRootDomainFromHeaders', () => {
        it('should extract root domain from a subdomain host', () => {
            const headers = new Headers({ host: 'airo-builder.test-godaddy.com' });
            expect(getRootDomainFromHeaders(headers)).toBe('test-godaddy.com');
        });

        it('should extract root domain from a deeply nested subdomain', () => {
            const headers = new Headers({ host: 'debug.airo-builder.godaddy.com' });
            expect(getRootDomainFromHeaders(headers)).toBe('godaddy.com');
        });

        it('should return dev-godaddy.com for localhost', () => {
            const headers = new Headers({ host: 'localhost:3000' });
            expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
        });

        it('should return dev-godaddy.com for 127.0.0.1', () => {
            const headers = new Headers({ host: '127.0.0.1:3000' });
            expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
        });

        it('should return dev-godaddy.com for local.gasket.dev-godaddy.com', () => {
            const headers = new Headers({ host: 'local.gasket.dev-godaddy.com' });
            expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
        });

        it('should strip port from host before extracting', () => {
            const headers = new Headers({ host: 'airo-builder.gdcorp.tools:8443' });
            expect(getRootDomainFromHeaders(headers)).toBe('gdcorp.tools');
        });

        it('should return null when host header is missing', () => {
            const headers = new Headers();
            expect(getRootDomainFromHeaders(headers)).toBeNull();
        });

        it('should handle host with hyphenated root domain', () => {
            const headers = new Headers({ host: 'app.dev-godaddy.com' });
            expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
        });

        it('should reject domains not in the allowlist', () => {
            const headers = new Headers({ host: 'evil.com' });
            expect(getRootDomainFromHeaders(headers)).toBeNull();
        });

        it('should reject attacker-controlled subdomains', () => {
            const headers = new Headers({ host: 'sso.evil.com' });
            expect(getRootDomainFromHeaders(headers)).toBeNull();
        });

        it('should accept all allowlisted domains', () => {
            for (const domain of ['godaddy.com', 'test-godaddy.com', 'dev-godaddy.com', 'gdcorp.tools']) {
                const headers = new Headers({ host: `app.${domain}` });
                expect(getRootDomainFromHeaders(headers)).toBe(domain);
            }
        });
    });
});
