import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/gd-auth-service', () => ({
    gdAuthService: {
        extractTokenFromRequest: vi.fn(),
        authenticate: vi.fn(),
    },
}));

vi.mock('@/lib/getRootDomain', () => ({
    getRootDomainFromHeaders: vi.fn(function () { return 'godaddy.com'; }),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { gdAuthService } from '@/lib/gd-auth-service';
import { __clearAdGroupsCacheForTests, intersectGroupsCaseInsensitive, validateApiAuth } from '@/lib/api-auth';

describe('api-auth', () => {
    describe('#intersectGroupsCaseInsensitive', () => {
        it('returns the matching required group when the user is a member', () => {
            const result = intersectGroupsCaseInsensitive(
                ['CRM_Skip', 'OtherGroup'],
                ['Dev-Airo-Builders', 'CRM_Skip'],
            );
            expect(result).toEqual(['CRM_Skip']);
        });

        it('returns multiple matches in the order they appear in `required`', () => {
            const result = intersectGroupsCaseInsensitive(
                ['Dev-Airo-Builders', 'CRM_Skip', 'directors-plus'],
                ['CRM_Skip', 'directors-plus'],
            );
            expect(result).toEqual(['CRM_Skip', 'directors-plus']);
        });

        it('matches case-insensitively', () => {
            const result = intersectGroupsCaseInsensitive(
                ['crm_skip', 'DEV-AIRO-BUILDERS'],
                ['CRM_Skip', 'Dev-Airo-Builders'],
            );
            expect(result).toEqual(['CRM_Skip', 'Dev-Airo-Builders']);
        });

        it('returns an empty array when there is no match', () => {
            const result = intersectGroupsCaseInsensitive(
                ['UnrelatedGroup'],
                ['CRM_Skip', 'Dev-Airo-Builders'],
            );
            expect(result).toEqual([]);
        });

        it('returns an empty array when `required` is empty (no group grants access)', () => {
            const result = intersectGroupsCaseInsensitive(
                ['CRM_Skip', 'Dev-Airo-Builders'],
                [],
            );
            expect(result).toEqual([]);
        });

        it('returns an empty array when the user has no groups', () => {
            const result = intersectGroupsCaseInsensitive(
                [],
                ['CRM_Skip', 'Dev-Airo-Builders'],
            );
            expect(result).toEqual([]);
        });
    });

    describe('#validateApiAuth (allow/deny via SSO membership)', () => {
        const fakeRequest = { headers: new Headers() } as unknown as NextRequest;
        let originalFetch: typeof globalThis.fetch;

        beforeEach(() => {
            __clearAdGroupsCacheForTests();
            vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue('jwt-token');
            vi.mocked(gdAuthService.authenticate).mockResolvedValue({
                valid: true,
                payload: { shopperId: 's-1', cid: 'c-1', email: 'u@example.com' },
            } as Awaited<ReturnType<typeof gdAuthService.authenticate>>);
            originalFetch = globalThis.fetch;
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
            vi.clearAllMocks();
            __clearAdGroupsCacheForTests();
        });

        it('grants access when the user is in the default allowlist', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: { groups: ['CRM_Skip', 'OtherGroup'] } }),
            }) as unknown as typeof fetch;

            const result = await validateApiAuth(fakeRequest);

            expect(result.authenticated).toBe(true);
        });

        it('grants access when the user is in the legal_admin AD group', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: { groups: ['legal_admin'] } }),
            }) as unknown as typeof fetch;

            const result = await validateApiAuth(fakeRequest);

            expect(result.authenticated).toBe(true);
        });

        it('denies access with 403 when the user is in no allowed group', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: { groups: ['UnrelatedGroup'] } }),
            }) as unknown as typeof fetch;

            const result = await validateApiAuth(fakeRequest);

            expect(result.authenticated).toBe(false);
            if (!result.authenticated) {
                expect(result.error.status).toBe(403);
            }
        });

        it('grants access via custom adGroupAny when the user matches', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: { groups: ['SpecialGroup'] } }),
            }) as unknown as typeof fetch;

            const result = await validateApiAuth(fakeRequest, { adGroupAny: ['SpecialGroup'] });

            expect(result.authenticated).toBe(true);
        });

        it('denies access via exclusive adGroup when the user only has another allowlisted group', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: { groups: ['CRM_Skip'] } }),
            }) as unknown as typeof fetch;

            const result = await validateApiAuth(fakeRequest, { adGroup: 'OPS-Airo-Builders-Admin' });

            expect(result.authenticated).toBe(false);
            if (!result.authenticated) {
                expect(result.error.status).toBe(403);
            }
        });

        it('skips membership check when skipMembership is true', async () => {
            globalThis.fetch = vi.fn();

            const result = await validateApiAuth(fakeRequest, { skipMembership: true });

            expect(result.authenticated).toBe(true);
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('returns 401 when no token is present', async () => {
            vi.mocked(gdAuthService.extractTokenFromRequest).mockReturnValue(null);

            const result = await validateApiAuth(fakeRequest);

            expect(result.authenticated).toBe(false);
            if (!result.authenticated) {
                expect(result.error.status).toBe(401);
            }
            expect(vi.mocked(gdAuthService.authenticate)).not.toHaveBeenCalled();
        });

        it('caches AD group lookup so concurrent requests share one SSO call', async () => {
            // The fetch storm in dev was 36 SSO calls in 30s for the same user.
            // Cache must dedupe both serial and concurrent calls for the same JWT.
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ data: { groups: ['CRM_Skip'] } }),
            }) as unknown as typeof fetch;
            globalThis.fetch = fetchMock;

            const [a, b, c] = await Promise.all([
                validateApiAuth(fakeRequest),
                validateApiAuth(fakeRequest),
                validateApiAuth(fakeRequest),
            ]);
            const d = await validateApiAuth(fakeRequest);

            expect(a.authenticated).toBe(true);
            expect(b.authenticated).toBe(true);
            expect(c.authenticated).toBe(true);
            expect(d.authenticated).toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('does not cache failures so transient SSO outages recover immediately', async () => {
            const fetchMock = vi.fn()
                .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ data: { groups: ['CRM_Skip'] } }),
                }) as unknown as typeof fetch;
            globalThis.fetch = fetchMock;

            const first = await validateApiAuth(fakeRequest);
            expect(first.authenticated).toBe(false);

            const second = await validateApiAuth(fakeRequest);
            expect(second.authenticated).toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});
