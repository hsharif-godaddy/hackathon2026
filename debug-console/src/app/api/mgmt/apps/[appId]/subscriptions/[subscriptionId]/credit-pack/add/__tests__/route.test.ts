import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthResult } from '@/lib/api-auth';

const mockAuth: AuthResult = {
    authenticated: true,
    user: { shopperId: 'shop-1', cid: 'cid-1', email: 'admin@test.com' },
} as AuthResult;

const mockShouldBypassAuth = vi.fn(() => ({ bypass: false, reason: 'test' }));

vi.mock('@/lib/api-auth', () => ({
    withAuth: (handler: Function) => (request: NextRequest, context: unknown) =>
        handler(request, mockAuth, context),
    shouldBypassAuth: () => mockShouldBypassAuth(),
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/analytics/es-client', () => ({
    INDICES: { CREDIT_PACKS: 'test_credit_packs' },
    writeClient: { search: vi.fn(), create: vi.fn() },
    initIndices: vi.fn().mockResolvedValue(undefined),
    bulkIndex: vi.fn(),
    isProdES: vi.fn(() => false),
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
    getLatestCreditPack: vi.fn().mockResolvedValue(null),
    claimCreditPackSlot: vi.fn().mockResolvedValue('claimed'),
    indexCreditPackDoc: vi.fn().mockResolvedValue(true),
    CREDIT_PACK_STATUS: { INIT: 'init', COMPLETE: 'complete', FAILED: 'failed' },
    CREDITS_MAX: 250,
}));

vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
    default: {
        getAppDetails: vi.fn().mockResolvedValue({ subscriptionId: 'sub1' }),
        addCreditGrant: vi.fn().mockResolvedValue({
            grant: { llmBudgetUserId: 'budget-1' },
        }),
    },
}));

vi.mock('@/lib/mgmt-helpers', () => ({
    APP_ID_RE: /^[a-z0-9]+$/,
    SUBSCRIPTION_ID_RE: /^[a-z0-9]+$/,
    validateId: vi.fn(() => null),
    handleMgmtError: vi.fn((_err, msg) => {
        const { NextResponse: NR } = require('next/server');
        return NR.json({ error: msg }, { status: 500 });
    }),
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
        const response = await (POST as Function)(makePostRequest({}), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when notes is empty string', async () => {
        const { POST } = await import('../route');
        const response = await (POST as Function)(makePostRequest({ notes: '' }), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when notes is whitespace only', async () => {
        const { POST } = await import('../route');
        const response = await (POST as Function)(makePostRequest({ notes: '   ' }), mockContext);

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
        const response = await (POST as Function)(request, mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('notes is required');
    });

    it('should return 400 when notes exceeds word limit', async () => {
        const { POST } = await import('../route');
        const overLimit = Array.from({ length: 201 }, (_, i) => `word${i}`).join(' ');
        const response = await (POST as Function)(makePostRequest({ notes: overLimit }), mockContext);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('200 word limit');
    });

    it('should return 201 when notes is provided', async () => {
        const { POST } = await import('../route');
        const response = await (POST as Function)(
            makePostRequest({ notes: 'Customer reported downtime' }),
            mockContext,
        );

        expect(response.status).toBe(201);
    });

    it('should return 403 when isProdES and auth bypass are both true', async () => {
        const { isProdES } = await import('@/lib/analytics/es-client');
        vi.mocked(isProdES).mockReturnValue(true);
        mockShouldBypassAuth.mockReturnValue({ bypass: true, reason: 'NODE_ENV=development' });

        const { POST } = await import('../route');
        const response = await (POST as Function)(
            makePostRequest({ notes: 'some note' }),
            mockContext,
        );

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error).toContain('auth bypass');

        vi.mocked(isProdES).mockReturnValue(false);
        mockShouldBypassAuth.mockReturnValue({ bypass: false, reason: 'test' });
    });

    it('should sanitize notes before processing', async () => {
        const { getCreditPackDoc } = await import('@/lib/credit-pack-utils');
        const { POST } = await import('../route');

        await (POST as Function)(
            makePostRequest({ notes: 'valid note <script>alert(1)</script>' }),
            mockContext,
        );

        expect(vi.mocked(getCreditPackDoc)).toHaveBeenCalledWith(
            'app1', 'sub1', mockAuth,
            expect.not.stringContaining('<script>'),
        );
    });
});
