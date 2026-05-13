import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthResult } from '@/lib/api-auth';

type RouteHandler = (request: NextRequest, context: unknown) => Promise<NextResponse>;
type AuthHandler = (request: NextRequest, auth: AuthResult, context: unknown) => Promise<NextResponse>;

const mockAuth: AuthResult = {
    authenticated: true,
    user: { shopperId: 'shop-1', cid: 'cid-1', email: 'admin@test.com' },
} as AuthResult;

vi.mock('@/lib/api-auth', () => ({
    withAuth: (handler: AuthHandler) => (request: NextRequest, context: unknown) =>
        handler(request, mockAuth, context),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/analytics/es-client', () => ({
    INDICES: { CREDIT_PACKS: 'test_credit_packs' },
    writeClient: { search: vi.fn(), create: vi.fn() },
    initIndices: vi.fn().mockResolvedValue(undefined),
    bulkIndex: vi.fn(),
}));

vi.mock('@/lib/credit-pack-utils', () => ({
    getCreditPackDoc: vi.fn(() => ({
        es_id: 'doc-1',
        timestamp: '2026-04-04T00:00:00Z',
        app_id: 'app-1',
        subscription_id: 'sub-1',
        status: 'init',
        credits_max: 250,
        use_before: '2026-05-04T00:00:00Z',
        next_credit_allowed_after: '2026-04-05T00:00:00Z',
        notes: 'valid note',
    })),
    indexCreditPackDoc: vi.fn().mockResolvedValue(true),
    CREDIT_PACK_STATUS: { INIT: 'init', COMPLETE: 'complete', FAILED: 'failed' },
    CREDIT_PACK_OPTIONS: [100, 250],
    CREDITS_MAX: 250,
}));

vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
    default: {
        getAppDetails: vi.fn().mockResolvedValue({ subscriptionId: 'sub1' }),
        getSubscriptionGrants: vi.fn().mockResolvedValue({ grants: [], activeGrant: null }),
        addCreditGrant: vi.fn().mockResolvedValue({
            grant: { llmBudgetUserId: 'budget-1' },
        }),
    },
}));

vi.mock('@/lib/mgmt-helpers', () => ({
    APP_ID_RE: /^[a-z0-9]+$/,
    SUBSCRIPTION_ID_RE: /^[a-z0-9]+$/,
    validateId: vi.fn(() => null),
    handleMgmtError: vi.fn((_err: unknown, msg: string) =>
        NextResponse.json({ error: msg }, { status: 500 })
    ),
}));

function makePostRequest(body?: unknown): NextRequest {
    return new NextRequest('http://localhost/api/mgmt/apps/app1/subscriptions/sub1/credit-pack/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

const mockContext = {
    params: Promise.resolve({ appId: 'app1', subscriptionId: 'sub1' }),
};

describe('credit-pack add route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 when notes is missing from body', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest({}), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when notes is empty string', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest({ notes: '' }), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when notes is whitespace only', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest({ notes: '   ' }), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when body is not valid JSON', async () => {
        const { POST } = await import('../route');
        const request = new NextRequest('http://localhost/api/mgmt/apps/app1/subscriptions/sub1/credit-pack/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const response = await (POST as RouteHandler)(request, mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when notes exceeds word limit', async () => {
        const { POST } = await import('../route');
        const overLimit = Array.from({ length: 201 }, (_, i) => `word${i}`).join(' ');
        const response = await (POST as RouteHandler)(makePostRequest({ notes: overLimit }), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('200 word limit');
    });

    it('should return 201 when notes and creditsMax are provided', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'Customer reported downtime', creditsMax: 250 }),
            mockContext,
        );

        expect(response.status).toBe(201);
    });

    it('should sanitize notes before processing', async () => {
        const { getCreditPackDoc } = await import('@/lib/credit-pack-utils');
        const { POST } = await import('../route');

        await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note <script>alert(1)</script>', creditsMax: 250 }),
            mockContext,
        );

        expect(vi.mocked(getCreditPackDoc)).toHaveBeenCalledWith(
            'app1', 'sub1', mockAuth.authenticated ? mockAuth.user : undefined,
            expect.not.stringContaining('<script>'),
            250,
        );
    });

    it('should return 400 when creditsMax is missing', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note' }),
            mockContext,
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('creditsMax must be one of');
    });

    it('should return 400 when creditsMax is not in CREDIT_PACK_OPTIONS', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 1000 }),
            mockContext,
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('creditsMax must be one of');
    });

    it('should pass selected creditsMax (100) through to getCreditPackDoc', async () => {
        const { getCreditPackDoc } = await import('@/lib/credit-pack-utils');
        const { POST } = await import('../route');

        await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 100 }),
            mockContext,
        );

        expect(vi.mocked(getCreditPackDoc)).toHaveBeenCalledWith(
            'app1', 'sub1', mockAuth.authenticated ? mockAuth.user : undefined,
            'valid note', 100,
        );
    });

    it('should reject when active admin credit-pack credits sum to >= 500', async () => {
        const mgmt = (await import('@/lib/mgmt-control-plane-adapter')).default;
        vi.mocked(mgmt.getSubscriptionGrants).mockResolvedValueOnce({
            grants: [
                { type: 'credit-pack', source: 'admin', isAvailable: true, creditsMax: 250 },
                { type: 'credit-pack', source: 'admin', isAvailable: true, creditsMax: 250 },
            ] as never,
            activeGrant: null,
        });

        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 100 }),
            mockContext,
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error_code).toBe('ACTIVE_CREDITS_LIMIT_EXCEEDED');
    });

    it('should ignore non-admin source grants in the active credits check', async () => {
        const mgmt = (await import('@/lib/mgmt-control-plane-adapter')).default;
        vi.mocked(mgmt.getSubscriptionGrants).mockResolvedValueOnce({
            grants: [
                { type: 'credit-pack', source: 'ecomm', isAvailable: true, creditsMax: 1000 },
            ] as never,
            activeGrant: null,
        });

        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 100 }),
            mockContext,
        );

        expect(response.status).toBe(201);
    });

    it('should ignore non-credit-pack type grants in the active credits check', async () => {
        const mgmt = (await import('@/lib/mgmt-control-plane-adapter')).default;
        vi.mocked(mgmt.getSubscriptionGrants).mockResolvedValueOnce({
            grants: [
                { type: 'plan-monthly', source: 'admin', isAvailable: true, creditsMax: 1000 },
            ] as never,
            activeGrant: null,
        });

        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 100 }),
            mockContext,
        );

        expect(response.status).toBe(201);
    });

    it('should write INIT-state ES doc before calling addCreditGrant', async () => {
        const { indexCreditPackDoc } = await import('@/lib/credit-pack-utils');
        const { POST } = await import('../route');

        await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 250 }),
            mockContext,
        );

        const calls = vi.mocked(indexCreditPackDoc).mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(2);
        expect(calls[0][0].status).toBe('init');
        expect(calls[calls.length - 1][0].status).toBe('complete');
    });

    it('should fail with 500 when INIT-state ES write fails', async () => {
        const { indexCreditPackDoc } = await import('@/lib/credit-pack-utils');
        vi.mocked(indexCreditPackDoc).mockResolvedValueOnce(false);

        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ notes: 'valid note', creditsMax: 250 }),
            mockContext,
        );

        expect(response.status).toBe(500);
    });
});
